/* Firebase data layer for HR Payroll. Reads the `firebaseConfig` declared in firebase-config.js. */
(function () {
  "use strict";

  // Firestore rejects undefined, Infinity/NaN and nested arrays. JSON round-trip drops undefined and turns
  // Infinity/NaN into null; any array-inside-array is wrapped as {items: [...]} so the write cannot fail.
  function clean(value) {
    function fix(v) {
      if (Array.isArray(v)) return v.map(function (x) { return Array.isArray(x) ? { items: fix(x) } : fix(x); });
      if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = fix(v[k]); }); return o; }
      return v;
    }
    return fix(JSON.parse(JSON.stringify(value || {})));
  }

  // Firestore Timestamps (createdAt, updatedAt, or any date saved as a Timestamp) become ISO strings
  // so the app can display and re-save them safely.
  function toPlain(v) {
    if (v === null || v === undefined) return v;
    if (typeof v.toDate === "function") {
      try { return v.toDate().toISOString(); } catch (e) { return null; }
    }
    if (Array.isArray(v)) return v.map(toPlain);
    if (typeof v === "object") {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = toPlain(v[k]); });
      return o;
    }
    return v;
  }

  function byNewest(a, b) {
    var x = String(a.createdAt || a.recordedAt || ""), y = String(b.createdAt || b.recordedAt || "");
    return x < y ? 1 : (x > y ? -1 : 0);
  }

  function docsToList(snap) {
    if (!snap) return [];
    return snap.docs.map(function (d) { return Object.assign(toPlain(d.data()), { id: d.id }); }).sort(byNewest);
  }

  window.HRPayrollCloud = {
    ready: false,
    db: null,
    auth: null,
    lastError: "",

    init: function () {
      this.lastError = "";
      if (!window.firebase) {
        this.lastError = "The Firebase SDK did not load (check your internet connection, or whether gstatic.com is blocked).";
        return false;
      }
      var c = window.HR_PAYROLL_FIREBASE_CONFIG;
      if (!c) {
        this.lastError = "firebase-config.js did not load or does not define HR_PAYROLL_FIREBASE_CONFIG.";
        return false;
      }
      if (!c.apiKey || !c.projectId || !c.appId) {
        this.lastError = "firebaseConfig is missing apiKey, projectId or appId.";
        return false;
      }
      try {
        if (!firebase.apps.length) firebase.initializeApp(c);
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        try { this.db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) { /* settings already applied */ }
        this.ready = true;
        return true;
      } catch (e) {
        console.error("Firebase initialization failed:", e);
        this.lastError = "Firebase initialization failed: " + (e && e.message || e);
        return false;
      }
    },

    organizationRef: function (uid) {
      return this.db.collection("organizations").doc(uid);
    },

    settingsRef: function (uid) {
      return this.organizationRef(uid).collection("data").doc("settings");
    },

    employeesRef: function (uid) {
      return this.organizationRef(uid).collection("employees");
    },

    payrollsRef: function (uid) {
      return this.organizationRef(uid).collection("payrolls");
    },

    statutoryUpdatesRef: function (uid) {
      return this.organizationRef(uid).collection("statutoryUpdates");
    },

    memberRef: function (uid) {
      return this.organizationRef(uid).collection("members").doc(uid);
    },

    saveOrganization: function (user, data) {
      return this.organizationRef(user.uid).set(
        Object.assign({}, clean(data), {
          ownerUid: user.uid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      );
    },

    saveMember: function (user, data) {
      return this.memberRef(user.uid).set(
        Object.assign({}, clean(data), {
          uid: user.uid,
          role: "owner",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      );
    },

    saveSettings: function (user, data) {
      var payload = clean(data);
      delete payload.createdAt; // timestamps are managed by the server
      return this.settingsRef(user.uid).set(
        Object.assign({}, payload, {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      );
    },

    // Every part is read independently, with no orderBy (ordering is done in the browser), so one
    // failing or incomplete collection can never hide the others. Failures are returned in `errors`.
    loadWorkspace: async function (user) {
      var uid = user.uid, errors = [];

      function part(name, promise) {
        return promise.then(function (r) { return r; }, function (e) {
          console.error("Firestore read failed for " + name + ":", e);
          errors.push({ part: name, message: (e && e.code ? e.code + ": " : "") + ((e && e.message) || String(e)) });
          return null;
        });
      }

      var results = await Promise.all([
        part("organization", this.organizationRef(uid).get()),
        part("settings", this.settingsRef(uid).get()),
        part("employees", this.employeesRef(uid).get()),
        part("payrolls", this.payrollsRef(uid).get()),
        part("statutoryUpdates", this.statutoryUpdatesRef(uid).get())
      ]);

      if (errors.length === 5) throw new Error(errors[0].message);

      var orgSnap = results[0], settingsSnap = results[1];
      var settings = settingsSnap && settingsSnap.exists ? toPlain(settingsSnap.data()) : {};
      delete settings.updatedAt;
      delete settings.createdAt;

      return {
        organization: orgSnap && orgSnap.exists ? toPlain(orgSnap.data()) : {},
        settings: settings,
        employees: docsToList(results[2]),
        payrolls: docsToList(results[3]),
        statutoryUpdates: docsToList(results[4]),
        errors: errors
      };
    },

    addEmployee: function (user, employee) {
      return this.employeesRef(user.uid).add(Object.assign({}, clean(employee), {
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
    },

    updateEmployee: function (user, id, employee) {
      var payload = clean(employee);
      delete payload.createdAt; // never overwrite the original creation date
      return this.employeesRef(user.uid).doc(id).set(
        Object.assign({}, payload, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() }),
        { merge: true }
      );
    },

    deleteEmployee: function (user, id) {
      return this.employeesRef(user.uid).doc(id).delete();
    },

    addPayroll: function (user, payroll) {
      return this.payrollsRef(user.uid).add(Object.assign({}, clean(payroll), {
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
    },

    addStatutoryUpdate: function (user, update) {
      return this.statutoryUpdatesRef(user.uid).add(Object.assign({}, clean(update), {
        recordedAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
    }
  };
})();