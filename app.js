(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Defaults                                                           */
  /* ------------------------------------------------------------------ */

  function defaultAgencies() {
    return [
      { code: "ZRA", logo: "https://www.zra.org.zm/wp-content/uploads/2019/10/cropped-cropped-zra_logo_bird-02.png", fallbackLogo: "assets/logos/zra.svg", name: "Zambia Revenue Authority", role: "PAYE & SDL", url: "https://www.zra.org.zm/" },
      { code: "NAPSA", logo: "https://www.zimmarketing.org.zm/wp-content/uploads/2024/05/napsa.jpeg", fallbackLogo: "assets/logos/napsa.svg", name: "National Pension Scheme Authority", role: "Pension contributions", url: "https://www.napsa.co.zm/" },
      { code: "NHIMA", logo: "https://enhima.nhima.co.zm/images/logo/4.png", fallbackLogo: "assets/logos/nhima.svg", name: "National Health Insurance Management Authority", role: "Health insurance", url: "https://www.nhima.co.zm/" },
      { code: "WCFCB", logo: "https://www.workers.com.zm/images/logo.png", fallbackLogo: "assets/logos/wcfcb.svg", name: "Workers Compensation Fund Control Board", role: "Workers compensation", url: "https://www.workers.com.zm/" },
      { code: "PACRA", logo: "https://www.zimmarketing.org.zm/wp-content/uploads/2025/04/pacra-logo.png", fallbackLogo: "assets/logos/pacra.svg", name: "Patents and Companies Registration Agency", role: "Company compliance", url: "https://pacra.org.zm/" },
      { code: "ZDA", logo: "https://www.zambiainvest.com/wp-content/uploads/2021/02/Zambia-Development-Agency-ZDA.png", fallbackLogo: "assets/logos/zda.svg", name: "Zambia Development Agency", role: "Investment & enterprise", url: "https://zda.org.zm/" },
      { code: "ZEMA", logo: "assets/logos/zema.svg", fallbackLogo: "assets/logos/zema.svg", name: "Zambia Environmental Management Agency", role: "Environmental compliance", url: "https://www.zema.org.zm/" }
    ];
  }

  function defaultPayrollRules() {
    return {
      paye: { bands: [{ upTo: 5100, rate: 0 }, { upTo: 7100, rate: 0.20 }, { upTo: 9200, rate: 0.30 }, { upTo: null, rate: 0.37 }] },
      napsa: { employeeRate: 0.05, employerRate: 0.05, ceiling: 28920.30 },
      nhima: { employeeRate: 0.01, employerRate: 0.01, basis: "basic" },
      sdl: { employerRate: 0.005 },
      wcfcb: { employerRate: 0, note: "Industry-specific assessment; enter the applicable rate." }
    };
  }

  function defaultSettings() {
    return {
      companyName: "",
      pacraRegistrationNumber: "",
      organizationHierarchy: [],
      departments: [],
      jobDescriptions: [],
      leaveRecords: [],
      performanceObjectives: [],
      performanceReviews: [],
      trainingPrograms: [],
      agencyRecords: {},
      taxYear: 2026,
      rates: { PAYE: "Not set", NAPSA: "Not set", NHIMA: "Not set", "SDL / SDC": "Not set", WCFCB: "Not set" },
      agencies: defaultAgencies(),
      payrollRules: defaultPayrollRules()
    };
  }

  // Settings keys that hold user-entered HR records (stored inside the settings document)
  var HR_KEYS = ["organizationHierarchy", "departments", "jobDescriptions", "leaveRecords", "performanceObjectives", "performanceReviews", "trainingPrograms"];

  var state = {
    view: "overview",
    user: null,
    cloud: false,
    loadError: "",
    employees: [],
    payrolls: [],
    statutoryUpdates: [],
    settings: defaultSettings()
  };

  var loadToken = 0;

  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c];
    });
  }

  function money(value) {
    return "K" + Number(value || 0).toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function initials(name) {
    return String(name || "Employee").split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join("").toUpperCase() || "E";
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  // Shows ISO strings, "YYYY-MM-DD" strings and Date values as e.g. "12 Oct 2026".
  function fmtDate(v) {
    if (!v) return "—";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-ZM", { year: "numeric", month: "short", day: "numeric" });
  }

  // Firestore rejects `undefined`, NaN-sensitive values and class instances. A JSON round trip makes any object safe to send.
  function clean(obj) { return JSON.parse(JSON.stringify(obj === undefined ? null : obj)); }

  function settingsForCloud() {
    var s = clean(state.settings);
    delete s.agencies; // static list, rebuilt on every load
    return s;
  }

  function toast(message, error) {
    var region = $("#toast-region");
    if (!region) { console.log(message); return; }
    var el = document.createElement("div");
    el.className = "toast" + (error ? " error" : "");
    el.textContent = message;
    region.appendChild(el);
    setTimeout(function () { el.remove(); }, error ? 7000 : 3500);
  }

  /* ------------------------------------------------------------------ */
  /*  Local cache (per signed-in user). Mirrors every change so data      */
  /*  can still be shown if Firestore cannot be read.                     */
  /* ------------------------------------------------------------------ */

  function localKey() {
    return "hr-payroll-workspace" + (state.user && state.user.uid ? ":" + state.user.uid : "");
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(localKey()) || "null"); }
    catch (e) { return null; }
  }

  function loadLocal() {
    var saved = readCache();
    if (!saved) return;
    state.employees = asArray(saved.employees);
    state.payrolls = asArray(saved.payrolls);
    state.statutoryUpdates = asArray(saved.statutoryUpdates);
    state.settings = Object.assign(defaultSettings(), saved.settings || {});
    ensureRules();
  }

  function saveLocal() {
    try {
      localStorage.setItem(localKey(), JSON.stringify({
        employees: state.employees,
        payrolls: state.payrolls,
        statutoryUpdates: state.statutoryUpdates,
        settings: state.settings
      }));
    } catch (e) { console.warn("Local cache could not be written", e); }
  }

  function resetWorkspace() {
    state.employees = [];
    state.payrolls = [];
    state.statutoryUpdates = [];
    state.settings = defaultSettings();
    state.loadError = "";
  }

  /* ------------------------------------------------------------------ */
  /*  Authentication                                                     */
  /* ------------------------------------------------------------------ */

  function setAuthMessage(message, error) {
    var msg = $("#auth-message");
    if (msg) {
      msg.textContent = message || "";
      msg.style.color = error ? "#a84b2c" : "";
    }
  }

  function showAuth(mode) {
    document.body.classList.add("auth-required");
    var panel = $(".auth-panel");
    if (!panel) return;
    panel.innerHTML = mode === "signup" ? signupMarkup() : signinMarkup();
    bindAuth();
  }

  function signinMarkup() {
    return '<p class="eyebrow">HR PAYROLL</p>' +
      '<h1>Sign in to your workspace</h1>' +
      '<p class="page-subtitle">Use your company owner email and password.</p>' +
      '<form class="auth-form" id="signin-form">' +
      '<div class="field"><label>Email</label><input id="auth-email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label>Password</label><input id="auth-password" type="password" autocomplete="current-password" required></div>' +
      '<p class="auth-message" id="auth-message"></p>' +
      '<button class="btn btn-primary" type="submit">Sign in</button>' +
      '</form>' +
      '<p class="auth-switch">New company? <button type="button" id="switch-signup">Create an account</button></p>' +
      '';
  }

  function signupMarkup() {
    return '<p class="eyebrow">HR PAYROLL</p>' +
      '<h1>Create company workspace</h1>' +
      '<p class="page-subtitle">Create the owner account for this company.</p>' +
      '<form class="auth-form" id="signup-form">' +
      '<div class="field"><label>Company name</label><input id="company-name" required placeholder="Registered company name"></div>' +
      '<div class="field"><label>PACRA company registration number</label><input id="pacra-registration" required placeholder="Enter PACRA registration number" autocomplete="off"></div>' +
      '<div class="field"><label>Owner name</label><input id="owner-name" required></div>' +
      '<div class="field"><label>Email</label><input id="auth-email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label>Password</label><input id="auth-password" type="password" minlength="6" autocomplete="new-password" required></div>' +
      '<p class="auth-message" id="auth-message"></p>' +
      '<button class="btn btn-primary" type="submit">Create workspace</button>' +
      '</form>' +
      '<p class="auth-switch">Already registered? <button type="button" id="switch-signin">Sign in</button></p>';
  }

  function bindAuth() {
    var signIn = $("#signin-form");
    var signUp = $("#signup-form");
    if ($("#switch-signup")) $("#switch-signup").onclick = function () { showAuth("signup"); };
    if ($("#switch-signin")) $("#switch-signin").onclick = function () { showAuth("signin"); };

    if (signIn) signIn.onsubmit = async function (e) {
      e.preventDefault();
      if (!state.cloud) {
        setAuthMessage("Firebase is not available. Use the real HR Payroll Firebase project to sign in.", true);
        return;
      }
      setAuthMessage("Signing in…");
      try {
        await HRPayrollCloud.auth.signInWithEmailAndPassword($("#auth-email").value.trim(), $("#auth-password").value);
      } catch (err) { handleAuthError(err); }
    };

    if (signUp) signUp.onsubmit = async function (e) {
      e.preventDefault();
      if (!state.cloud) {
        setAuthMessage("Firebase is not available. Use the real HR Payroll Firebase project to create a workspace.", true);
        return;
      }
      setAuthMessage("Creating workspace…");
      state.signingUp = true;
      try {
        var cred = await HRPayrollCloud.auth.createUserWithEmailAndPassword($("#auth-email").value.trim(), $("#auth-password").value);
        resetWorkspace();
        state.user = cred.user;
        state.settings.companyName = $("#company-name").value.trim();
        state.settings.pacraRegistrationNumber = $("#pacra-registration").value.trim();
        await HRPayrollCloud.saveOrganization(cred.user, clean({
          name: $("#company-name").value.trim(),
          ownerName: $("#owner-name").value.trim(),
          pacraRegistrationNumber: $("#pacra-registration").value.trim()
        }));
        await HRPayrollCloud.saveMember(cred.user, clean({ name: $("#owner-name").value.trim(), email: cred.user.email }));
        await HRPayrollCloud.saveSettings(cred.user, settingsForCloud());
        state.signingUp = false;
        await onUser(cred.user); // reload now that the organization docs exist
      } catch (err) { state.signingUp = false; handleAuthError(err); }
    };
  }

  // Probe the hosts Firebase needs so a network failure says WHICH one is unreachable.
  async function diagnoseNetwork() {
    if (navigator.onLine === false) return "This device is offline. Connect to the internet and try again.";
    var hosts = [
      ["https://identitytoolkit.googleapis.com/", "sign-in (identitytoolkit.googleapis.com)"],
      ["https://securetoken.googleapis.com/", "session tokens (securetoken.googleapis.com)"],
      ["https://firestore.googleapis.com/", "database (firestore.googleapis.com)"],
      ["https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js", "Firebase scripts (gstatic.com)"]
    ];
    var blocked = [];
    await Promise.all(hosts.map(async function (h) {
      var ctl = new AbortController();
      var t = setTimeout(function () { ctl.abort(); }, 8000);
      try { await fetch(h[0], { mode: "no-cors", cache: "no-store", signal: ctl.signal }); }
      catch (e) { blocked.push(h[1]); }
      finally { clearTimeout(t); }
    }));
    if (blocked.length) return "Your connection cannot reach: " + blocked.join("; ") + ". This is a network, firewall, VPN or ad-blocker problem, not an app problem. Try another network or mobile data, turn off VPN/ad-blocker for this site, then retry.";
    return "Google servers are reachable but the request still timed out. The connection is unstable; wait a moment and try again.";
  }

  async function handleAuthError(err) {
    if (err && err.code === "auth/network-request-failed") {
      setAuthMessage("Cannot reach Firebase. Checking your connection…", true);
      try { setAuthMessage(await diagnoseNetwork(), true); }
      catch (e) { setAuthMessage(firebaseError(err), true); }
      return;
    }
    setAuthMessage(firebaseError(err), true);
  }

  function firebaseError(err) {
    var map = {
      "auth/email-already-in-use": "That email is already registered.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/weak-password": "Password must contain at least 6 characters.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/user-not-found": "No account was found for that email.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
      "auth/operation-not-allowed": "Email/password sign-in is not enabled in the Firebase console (Authentication > Sign-in method).",
      "auth/network-request-failed": "Cannot reach Google's sign-in servers. Check your internet connection."
    };
    return map[err && err.code] || (err && err.message) || "Authentication failed.";
  }

  function enterDemo() {
    state.user = { uid: "local-demo", displayName: "Demo Owner", email: "demo@hrpayroll.local" };
    state.cloud = false;
    loadLocal();
    showApp();
    toast("Demo workspace loaded locally.");
  }

  /* ------------------------------------------------------------------ */
  /*  Loading the workspace from Firestore                               */
  /* ------------------------------------------------------------------ */

  function applyCloudData(data) {
    data = data || {};
    var cached = readCache(); // read BEFORE we overwrite the cache below
    var cloudSettings = data.settings || {};

    var failed = {};
    asArray(data.errors).forEach(function (er) { failed[er.part] = er.message; });
    if (failed.settings && cached && cached.settings) cloudSettings = cached.settings;

    state.employees = failed.employees && cached ? asArray(cached.employees) : asArray(data.employees);
    state.payrolls = failed.payrolls && cached ? asArray(cached.payrolls) : asArray(data.payrolls);
    state.statutoryUpdates = failed.statutoryUpdates && cached ? asArray(cached.statutoryUpdates) : asArray(data.statutoryUpdates);
    state.settings = Object.assign(defaultSettings(), cloudSettings);

    // The statutory update log is optional, so a problem reading it is logged but never shown as a banner.
    var critical = asArray(data.errors).filter(function (er) { return er.part !== "statutoryUpdates"; });
    if (failed.statutoryUpdates) console.warn("statutoryUpdates could not be read:", failed.statutoryUpdates);
    if (critical.length) {
      state.loadError = critical.map(function (er) { return er.part + " — " + er.message; }).join("; ");
      toast("Some data could not be read from Firestore: " + state.loadError, true);
    }

    if (data.organization && data.organization.name) state.settings.companyName = data.organization.name;
    if (data.organization && data.organization.pacraRegistrationNumber) state.settings.pacraRegistrationNumber = data.organization.pacraRegistrationNumber;

    ensureRules();

    // Self-heal: if Firestore returned no HR records for a section but this browser still has them,
    // restore them and push them back to Firestore so they are not lost.
    var healed = false;
    if (cached && cached.settings) {
      HR_KEYS.forEach(function (k) {
        if (!asArray(cloudSettings[k]).length && asArray(cached.settings[k]).length) {
          state.settings[k] = cached.settings[k];
          healed = true;
        }
      });
    }
    if (healed) {
      saveSettingsSilently();
      toast("Some saved HR records were missing in Firestore and have been restored from this browser.");
    }
    saveLocal();
  }

  async function onUser(user) {
    state.user = user;
    if (!user) {
      resetWorkspace();
      showAuth("signin");
      return;
    }
    if (state.signingUp) return; // sign-up handler loads the workspace after saving
    document.body.classList.remove("auth-required");
    var token = ++loadToken;
    state.loadError = "";

    if (state.cloud) {
      try {
        var data = await HRPayrollCloud.loadWorkspace(user);
        if (token !== loadToken) return; // a newer load started
        applyCloudData(data);
        document.documentElement.dataset.firebaseWorkspace = "loaded";
      } catch (e) {
        if (token !== loadToken) return;
        console.error("Firebase workspace load failed:", e);
        state.loadError = (e && e.code ? e.code + ": " : "") + ((e && e.message) || "Unknown error");
        resetWorkspace();
        state.loadError = (e && e.code ? e.code + ": " : "") + ((e && e.message) || "Unknown error");
        loadLocal();
        document.documentElement.dataset.firebaseWorkspace = "unavailable";
        toast("Could not read your data from Firestore (" + state.loadError + "). Showing the last copy saved in this browser.", true);
      }
    }
    ensureRules();
    showApp();
  }

  function showApp() {
    document.body.classList.remove("auth-required");
    updateShell();
    render();
  }

  function updateShell() {
    var name = state.settings.companyName || "Company";
    var owner = state.user && (state.user.displayName || state.user.email || "Company owner");
    $("#workspace-name").textContent = name || "Company";
    $("#sidebar-user-name").textContent = owner || "";
    $("#sidebar-user-email").textContent = state.cloud ? ((state.user && state.user.email) || "Signed in") : "Local demo";
    $("#top-avatar").textContent = initials(owner).charAt(0);
    $("#people-count").textContent = state.employees.length;
    $("#sidebar-tax-year").textContent = state.settings.taxYear || 2026;
    var rules = state.settings.payrollRules || {};
    $("#sidebar-paye-rate").textContent = "0 / 20 / 30 / 37%";
    $("#sidebar-napsa-rate").textContent = ((Number(rules.napsa && rules.napsa.employeeRate || .05) * 100).toFixed(0) + "% + " + (Number(rules.napsa && rules.napsa.employerRate || .05) * 100).toFixed(0) + "%");
    $("#sidebar-nhima-rate").textContent = ((Number(rules.nhima && rules.nhima.employeeRate || .01) * 100).toFixed(0) + "% + " + (Number(rules.nhima && rules.nhima.employerRate || .01) * 100).toFixed(0) + "% basic");
    $("#sidebar-sdl-rate").textContent = ((Number(rules.sdl && rules.sdl.employerRate || .005) * 100).toFixed(1) + "% employer");
    $("#sidebar-wcfcb-rate").textContent = rules.wcfcb && rules.wcfcb.employerRate ? ((Number(rules.wcfcb.employerRate) * 100).toFixed(2) + "% configured") : "Industry rate";
    var agencyHost = $("#sidebar-agencies");
    if (agencyHost) {
      agencyHost.innerHTML = (state.settings.agencies || []).map(function (a) {
        return '<a class="sidebar-agency" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + agencyLogoMarkup(a, false) + '<span><strong>' + esc(a.name) + '</strong><small>' + esc(a.role) + '</small></span><span class="agency-arrow">↗</span></a>';
      }).join("");
    }
  }

  function render() {
    var content = $("#page-content");
    if (!content) return;
    var views = { overview: renderOverview, people: renderPeople, payroll: renderPayroll, calculator: renderCalculator, statutory: renderStatutory, compliance: renderCompliance, reports: renderReports, settings: renderSettings, departments: renderDepartments, positions: renderPositions, leave: renderLeave, performance: renderPerformance, training: renderTraining, jobs: renderJobs };
    try {
      content.innerHTML = (views[state.view] || renderOverview)();
    } catch (err) {
      console.error("Render failed for view " + state.view, err);
      content.innerHTML = '<div class="notice info"><span class="notice-icon">i</span><div><strong>This page could not be displayed.</strong> ' + esc(err && err.message) + '</div></div>';
    }
    bindView();
    updateShell();
  }

  function loadErrorBanner() {
    if (!state.loadError) return "";
    return '<div class="notice info" style="margin-bottom:15px"><span class="notice-icon">!</span><div><strong>Firestore data could not be loaded.</strong> You are seeing the last copy saved in this browser. Error: ' + esc(state.loadError) + '. Check your Firestore security rules and that firebase-cloud.js reads the same collections it writes to.</div></div>';
  }

  function heading(title, subtitle, actions) {
    return '<div class="page-heading"><div><p class="eyebrow">HR PAYROLL</p><h1>' + esc(title) + '</h1><p class="page-subtitle">' + esc(subtitle) + '</p></div><div class="heading-actions">' + (actions || "") + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /*  Views                                                              */
  /* ------------------------------------------------------------------ */

  function renderOverview() {
    var total = state.employees.reduce(function (sum, e) { return sum + Number(e.salary || 0); }, 0);
    var active = state.employees.filter(function (e) { return e.status !== "Inactive"; }).length;
    var recentPayrolls = state.payrolls.slice(0, 5);
    var completed = state.payrolls.filter(function (p) { return p.status === "Completed" || !p.status; }).length;
    var company = state.settings.companyName || "Company";
    return loadErrorBanner() + '<section class="dashboard-hero"><div class="dashboard-hero-copy"><p class="eyebrow">ADMIN DASHBOARD</p><h1>Welcome, ' + esc(company) + '</h1><p>A clear overview of your HR & Payroll workspace.</p></div>' + organizationHierarchyMarkup() + '</section><div class="dashboard-hero-actions dashboard-hero-actions-below"><button class="btn btn-primary" data-action="add-employee"><span class="button-symbol">+</span> Add employee</button><button class="btn btn-secondary" data-action="open-calculator">Pay calculator</button></div>' +
      heading("Payroll overview", "Your existing payroll information, statutory controls and HR records in one workspace.", '') +
      '<div class="stat-grid dashboard-stat-grid">' +
      stat("Total employees", state.employees.length, active + " active") +
      stat("Departments", uniqueCount(state.employees, "department"), "Employee departments") +
      stat("Pending leave", asArray(state.settings.leaveRecords).filter(function (r) { return r.status === "Pending"; }).length, "Leave requests") +
      stat("Processed payrolls", completed, state.payrolls.length ? "Recorded payroll runs" : "No runs yet") +
      stat("Monthly gross", money(total), "Before statutory deductions") +
      stat("Tax year", state.settings.taxYear || 2026, "Current workspace rules") +
      '</div>' +
      '<div class="dashboard-grid dashboard-main-grid">' +
      '<section class="panel dashboard-table-panel"><div class="panel-header"><div><h2>Recent payroll records</h2><p>Latest processed payroll activity</p></div><button class="text-link" data-view="payroll">View payroll</button></div>' +
      recentPayrollTable(recentPayrolls) + '</section>' +
      '<section class="panel"><div class="panel-header"><div><h2>Workspace checklist</h2><p>Finish the setup before processing payroll</p></div></div><div class="panel-body checklist">' +
      checklistRow(!!state.settings.companyName, "Company profile", "Company name is available.", "settings") +
      checklistRow(state.employees.length > 0, "Add employees", "Create your first employee record.", "people") +
      checklistRow(!!state.settings.pacraRegistrationNumber, "PACRA registration", "Keep the company registration number on the workspace.", "settings") +
      checklistRow(!!(state.settings.payrollRules && state.settings.payrollRules.paye), "Set statutory rates", "Review payroll rules and effective dates.", "statutory") +
      checklistRow(state.employees.some(function (e) { return e.contractStart; }), "HR compliance records", "Keep contracts, policies and key employee dates in the workspace.", "compliance") +
      '</div></section></div>' +
      '<div class="dashboard-grid dashboard-secondary-grid">' +
      '<section class="panel"><div class="panel-header"><div><h2>Recent employees</h2><p>Your latest people records</p></div><button class="text-link" data-view="people">View all</button></div>' + employeeTable(state.employees.slice(0, 5)) + '</section>' +
      '<section class="panel"><div class="panel-header"><div><h2>Quick actions</h2><p>Common HR and payroll tasks</p></div></div><div class="quick-actions">' +
      quickAction("People", "Manage employee records", "people", "♙") +
      quickAction("Payroll", "Review payroll runs", "payroll", "▤") +
      quickAction("Calculator", "Calculate employee pay", "calculator", "∑") +
      quickAction("Compliance", "Review HR requirements", "compliance", "✓") +
      '</div></section></div>' + statutoryOverview();
  }

  function uniqueCount(items, key) {
    var seen = {};
    items.forEach(function (item) { var value = String(item[key] || "").trim(); if (value) seen[value.toLowerCase()] = true; });
    return Object.keys(seen).length;
  }

  function recentPayrollTable(items) {
    if (!items.length) return '<div class="empty-state compact-empty"><div class="empty-icon">▤</div><h3>No payroll runs yet</h3><p>Process payroll to see recent records here.</p><button class="btn btn-primary" data-action="open-calculator">Open calculator</button></div>';
    return '<div class="table-wrap"><table><thead><tr><th>Period</th><th>Employees</th><th>Gross</th><th>Net pay</th><th>Status</th></tr></thead><tbody>' +
      items.map(function (p) { return '<tr><td><strong>' + esc(p.period || "—") + '</strong></td><td>' + esc(p.employeeCount || 0) + '</td><td class="amount">' + money(p.gross) + '</td><td class="amount">' + money(p.net) + '</td><td><span class="badge badge-complete">' + esc(p.status || "Completed") + '</span></td></tr>'; }).join("") +
      '</tbody></table></div>';
  }

  function quickAction(title, copy, view, icon) {
    return '<button class="quick-action" data-view="' + esc(view) + '"><span class="quick-action-icon">' + icon + '</span><span><strong>' + esc(title) + '</strong><small>' + esc(copy) + '</small></span><span class="quick-arrow">→</span></button>';
  }

  function stat(label, value, foot) {
    return '<article class="stat-card"><div class="stat-top"><span>' + esc(label) + '</span><span class="stat-icon">•</span></div><div class="stat-value">' + esc(value) + '</div><div class="stat-foot">' + esc(foot) + '</div></article>';
  }

  function checklistRow(done, title, copy, view) {
    return '<div class="check-row"><span class="check-mark' + (done ? "" : " pending") + '">' + (done ? "✓" : "•") + '</span><div class="check-copy"><strong>' + esc(title) + '</strong><small>' + esc(copy) + '</small></div><button class="text-link" data-view="' + view + '">' + (done ? "Review" : "Open") + '</button></div>';
  }

  function employeeTable(items) {
    if (!items.length) return '<div class="empty-state"><div class="empty-icon">♙</div><h3>No employees yet</h3><p>Add your first employee to start building the payroll workspace.</p><button class="btn btn-primary" data-action="add-employee">Add employee</button></div>';
    return '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Gross salary</th><th>Contract start</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody>' +
      items.map(function (e, i) {
        return '<tr><td><div class="person-cell"><span class="person-avatar tone-' + (i % 4) + '">' + esc(initials(e.name)) + '</span><span><strong>' + esc(e.name) + '</strong><small>' + esc(e.employeeId || "No ID") + '</small></span></div></td>' +
          '<td>' + esc(e.department || "—") + '</td><td class="amount">' + money(e.salary) + '</td><td>' + esc(fmtDate(e.contractStart)) + '</td><td>' + esc(fmtDate(e.createdAt)) + '</td><td><span class="badge ' + (e.status === "Inactive" ? "badge-inactive" : "badge-active") + '">' + esc(e.status || "Active") + '</span></td>' +
          '<td><div class="table-actions"><button class="mini-button" data-action="calculate-employee" data-id="' + esc(e.id) + '" title="Calculate pay">∑</button><button class="mini-button" data-action="edit-employee" data-id="' + esc(e.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-employee" data-id="' + esc(e.id) + '" title="Delete">×</button></div></td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function simpleToolView(title, subtitle, icon, description, cards) {
    return heading(title, subtitle, '<button class="btn btn-primary" data-view="people">Manage employees</button>') +
      '<section class="panel tool-overview-panel"><div class="tool-overview-icon">' + icon + '</div><div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div></section>' +
      '<div class="dashboard-grid tool-card-grid">' + cards.map(function (c) { return '<section class="panel mini-tool-card"><div class="mini-tool-icon">' + c[0] + '</div><div><strong>' + esc(c[1]) + '</strong><p>' + esc(c[2]) + '</p></div></section>'; }).join('') + '</div>';
  }

  function renderDepartments() {
    var counts = {};
    state.employees.forEach(function (e) { var d = (e.department || 'Unassigned').trim(); counts[d] = (counts[d] || 0) + 1; });
    var departments = asArray(state.settings.departments);
    var rows = departments.map(function (d) {
      return '<tr><td><strong>' + esc(d.name) + '</strong></td><td>' + esc(d.description || '—') + '</td><td>' + esc(counts[d.name] || 0) + '</td><td><button class="mini-button" data-action="edit-department" data-id="' + esc(d.id) + '" title="Edit department">✎</button><button class="mini-button" data-action="delete-department" data-id="' + esc(d.id) + '" title="Delete department">×</button></td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="4" class="empty-note">No departments created yet. Add your first department below.</td></tr>';
    return heading('Departments', 'Create and manage the departments used across employee records.', '<button class="btn btn-primary" data-action="add-department">+ Add department</button>') +
      '<section class="panel"><div class="panel-header"><div><h2>Department directory</h2><p>Departments are saved with the company workspace and can be selected when adding employees.</p></div></div><div class="table-wrap"><table><thead><tr><th>Department</th><th>Description</th><th>Employees</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>How to use departments</h2><p>Keep department names consistent so payroll and HR reports remain easy to analyse.</p></div></div><div class="panel-body"><ol class="step-list"><li>Create the department and give it a clear name.</li><li>Add employees to the department from People.</li><li>Use the department field consistently in employee records.</li><li>Review department headcount in Reports and the dashboard.</li></ol></div></section>';
  }

  function renderPositions() {
    var positions = {};
    state.employees.forEach(function (e) { var d = (e.position || 'Unassigned').trim(); positions[d] = (positions[d] || 0) + 1; });
    var cards = Object.keys(positions).map(function (d) { return ['▤', d, positions[d] + ' employee' + (positions[d] === 1 ? '' : 's')]; });
    if (!cards.length) cards = [['▤', 'No positions yet', 'Add position information to employee records.']];
    return simpleToolView('Positions', 'View roles represented in your workforce.', '▤', 'Position information is linked to the employee records already in the workspace.', cards);
  }

  function numberToWordsBelowThousand(n) {
    var ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    var tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    n = Math.floor(Number(n) || 0);
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10].toLowerCase() : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + numberToWordsBelowThousand(n % 100) : "");
  }

  function integerToWords(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (n < 1000) return numberToWordsBelowThousand(n);
    var units = ["", "Thousand", "Million", "Billion", "Trillion"];
    var parts = [], index = 0;
    while (n > 0) {
      var chunk = n % 1000;
      if (chunk) parts.unshift(numberToWordsBelowThousand(chunk) + (units[index] ? " " + units[index] : ""));
      n = Math.floor(n / 1000);
      index += 1;
    }
    return parts.join(" ");
  }

  function amountInWords(value) {
    var amount = Math.max(0, Number(value) || 0);
    var whole = Math.floor(amount + 0.0000001);
    var ngwee = Math.round((amount - whole) * 100);
    if (ngwee === 100) { whole += 1; ngwee = 0; }
    return "Zambian Kwacha " + integerToWords(whole) + " and " + String(ngwee).padStart(2, "0") + " Ngwee Only";
  }

  function hrArray(key) {
    state.settings[key] = Array.isArray(state.settings[key]) ? state.settings[key] : [];
    return state.settings[key];
  }

  function leaveCatalog() {
    return [
      { id: "annual", name: "Annual Leave", section: "s.36", entitlement: "At least 2 days per month after 12 consecutive months (24 days per year)", maxDays: null, note: "At least 24 days per year is the statutory accrual shown here; an employment term can provide more favourable leave." },
      { id: "sick", name: "Sick Leave", section: "s.38", entitlement: "Short-term: 26 working days full pay + 26 working days half pay; long-term: 3 months full pay + 3 months half pay", maxDays: null, note: "The entitlement is split between short-term and long-term sick leave periods, so HR should record the applicable period rather than treating 52 days as a hard maximum." },
      { id: "compassionate", name: "Compassionate Leave", section: "s.39", entitlement: "At least 12 days per calendar year", maxDays: null, note: "The Act provides at least 12 days, so the system does not treat 12 as a hard maximum." },
      { id: "family-sick", name: "Family Responsibility — Sick Family", section: "s.40(1)", entitlement: "Up to 7 paid days per calendar year", maxDays: 7, note: "For nursing a sick spouse, child or dependant; qualifying service applies." },
      { id: "family-care", name: "Family Responsibility — Care / Health / Education", section: "s.40(2)", entitlement: "3 paid days per year", maxDays: 3, note: "For child, spouse or dependant care, health or education responsibilities; not cumulative or deducted from other leave." },
      { id: "maternity", name: "Maternity Leave", section: "s.41(1)", entitlement: "14 weeks (98 days); +4 weeks for a multiple birth", maxDays: null, note: "14 weeks is the standard statutory period; multiple-birth and premature-birth provisions can extend the period." },
      { id: "miscarriage-stillbirth", name: "Miscarriage / Stillbirth Leave", section: "s.41(6)", entitlement: "6 weeks (42 days) on full pay", maxDays: 42, note: "Applies subject to the statutory qualifying circumstances and certification." },
      { id: "paternity", name: "Paternity Leave", section: "s.46", entitlement: "At least 5 continuous working days", maxDays: 5, note: "Continuous service, birth documentation and timing conditions apply." },
      { id: "mothers-day", name: "Mother’s Day", section: "s.47", entitlement: "1 day per month", maxDays: 12, note: "Statutory day for a female employee; record it separately from annual leave." },
      { id: "forced", name: "Forced Leave", section: "s.48", entitlement: "Employer-directed; the section does not set a fixed day limit", maxDays: null, note: "Record the employer direction, dates and reason in the HR file." }
    ];
  }

  function specialLeaveProvisions() {
    return [
      { name: "Nursing breaks", section: "s.45", entitlement: "At least two 30-minute breaks or one 1-hour break each working day for six months from delivery", note: "Protected paid-hour breaks, not leave-day allocations." },
      { name: "Fitness to resume work after maternity", section: "s.42", entitlement: "Fitness-to-resume protections after maternity leave", note: "Record the relevant medical/HR documentation rather than reducing the leave balance." },
      { name: "Protection connected with maternity leave", section: "s.43", entitlement: "Statutory protection connected to maternity absence", note: "Keep the maternity record and related employment actions together." },
      { name: "Protection from harmful work during pregnancy", section: "s.44", entitlement: "Protected transfer/conditions where work is harmful during pregnancy", note: "This is a workplace protection, not a leave-day balance." }
    ];
  }

  function employeeOptions(selected) {
    return '<option value="">Select employee</option>' + state.employees.map(function (e) { return '<option value="' + esc(e.id) + '" ' + (e.id === selected ? 'selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.employeeId || 'No ID') + '</option>'; }).join('');
  }

  function renderLeave() {
    var records = hrArray('leaveRecords'), catalog = leaveCatalog(), provisions = specialLeaveProvisions();
    var pending = records.filter(function (r) { return r.status === 'Pending'; }).length;
    var approved = records.filter(function (r) { return r.status === 'Approved'; }).length;
    var totalDays = records.reduce(function (sum, r) { return sum + Number(r.days || 0); }, 0);
    var rows = records.map(function (r) {
      var statusClass = r.status === 'Approved' ? 'badge-complete' : (r.status === 'Rejected' ? 'badge-inactive' : 'badge-active');
      return '<tr><td><strong>' + esc(r.employeeName || '—') + '</strong><small>' + esc(r.employeeIdNumber || r.employeeId || '') + '</small></td><td>' + esc(r.leaveName || r.leaveType || '—') + '<small>' + esc(r.section || '') + '</small></td><td>' + esc(r.startDate || '—') + '</td><td>' + esc(r.endDate || '—') + '</td><td class="amount">' + esc(r.days || 0) + '</td><td><span class="badge ' + statusClass + '">' + esc(r.status || 'Pending') + '</span></td><td><button class="mini-button" data-action="edit-leave" data-id="' + esc(r.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-leave" data-id="' + esc(r.id) + '" title="Delete">×</button></td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="empty-note">No leave records yet. Assign a statutory leave type and record the days for an employee.</td></tr>';
    var catalogueRows = catalog.map(function (c) { return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc(c.section) + '</td><td>' + esc(c.entitlement) + '</td><td>' + esc(c.note) + '</td></tr>'; }).join('');
    var provisionRows = provisions.map(function (c) { return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc(c.section) + '</td><td>' + esc(c.entitlement) + '</td><td>' + esc(c.note) + '</td></tr>'; }).join('');
    return heading('Leave Management', 'Assign employee leave types, days, dates and approval records while keeping the statutory leave catalogue in view.', '<button class="btn btn-primary" data-action="add-leave">+ Assign leave</button>') +
      '<div class="stat-grid"><div class="stat-card"><div class="stat-top"><span>Leave records</span><span class="stat-icon">•</span></div><div class="stat-value">' + records.length + '</div><div class="stat-foot">Employee leave allocations</div></div><div class="stat-card"><div class="stat-top"><span>Pending</span><span class="stat-icon">•</span></div><div class="stat-value">' + pending + '</div><div class="stat-foot">Awaiting approval</div></div><div class="stat-card"><div class="stat-top"><span>Approved</span><span class="stat-icon">•</span></div><div class="stat-value">' + approved + '</div><div class="stat-foot">Approved records</div></div><div class="stat-card"><div class="stat-top"><span>Days recorded</span><span class="stat-icon">•</span></div><div class="stat-value">' + totalDays + '</div><div class="stat-foot">Across all leave records</div></div></div>' +
      '<section class="panel"><div class="panel-header"><div><h2>Employee leave records</h2><p>Assign an employee leave type, statutory entitlement, days, dates and approval status.</p></div><span class="badge badge-active">' + records.length + ' records</span></div><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Leave type</th><th>Start</th><th>End</th><th>Days</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>Employment Code Act leave catalogue</h2><p>Core leave categories captured from the Employment Code Act, 2019, sections 36–48. Statutory conditions still apply.</p></div></div><div class="table-wrap"><table><thead><tr><th>Leave type</th><th>Section</th><th>Statutory entitlement</th><th>Key condition</th></tr></thead><tbody>' + catalogueRows + '</tbody></table></div></section>' +
      '<section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>Related protected provisions</h2><p>These provisions support maternity and family-related rights but are not additional leave-day balances.</p></div></div><div class="table-wrap"><table><thead><tr><th>Provision</th><th>Section</th><th>What HR should record</th><th>Note</th></tr></thead><tbody>' + provisionRows + '</tbody></table></div></section>';
  }

  function renderPerformance() {
    var objectives = hrArray('performanceObjectives'), reviews = hrArray('performanceReviews');
    var objectiveRows = objectives.map(function (o) { return '<tr><td><strong>' + esc(o.employeeName || '—') + '</strong></td><td><strong>' + esc(o.title || '—') + '</strong><small>' + esc(o.description || '') + '</small></td><td>' + esc(o.targetDate || '—') + '</td><td><div class="progress-wrap"><div class="progress-track"><span style="width:' + Math.min(100, Math.max(0, Number(o.progress) || 0)) + '%"></span></div><small>' + esc(Number(o.progress) || 0) + '%</small></div></td><td><span class="badge badge-active">' + esc(o.status || 'In progress') + '</span></td><td><button class="mini-button" data-action="edit-objective" data-id="' + esc(o.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-objective" data-id="' + esc(o.id) + '" title="Delete">×</button></td></tr>'; }).join('');
    if (!objectiveRows) objectiveRows = '<tr><td colspan="6" class="empty-note">No objectives yet. Add an employee objective to start tracking progress.</td></tr>';
    var reviewRows = reviews.map(function (r) { return '<tr><td><strong>' + esc(r.employeeName || '—') + '</strong></td><td>' + esc(r.period || '—') + '</td><td>' + esc(r.reviewDate || '—') + '</td><td>' + esc(r.reviewer || '—') + '</td><td>' + esc(r.rating || 'Not rated') + '</td><td><button class="mini-button" data-action="edit-review" data-id="' + esc(r.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-review" data-id="' + esc(r.id) + '" title="Delete">×</button></td></tr>'; }).join('');
    if (!reviewRows) reviewRows = '<tr><td colspan="6" class="empty-note">No performance reviews yet. Create a periodic review record.</td></tr>';
    return heading('Manage Performance', 'Track employee objectives, progress and periodic performance reviews.', '<div class="heading-actions-inline"><button class="btn btn-primary" data-action="add-objective">+ Add objective</button><button class="btn btn-secondary" data-action="add-review">+ Add performance review</button></div>') +
      '<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Employee objectives & progress</h2><p>Set a clear objective, target date and current progress.</p></div></div><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Objective</th><th>Target date</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>' + objectiveRows + '</tbody></table></div></section>' +
      '<section class="panel"><div class="panel-header"><div><h2>Periodic performance reviews</h2><p>Create and retain employee performance review records.</p></div></div><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Review period</th><th>Date</th><th>Reviewer</th><th>Rating</th><th></th></tr></thead><tbody>' + reviewRows + '</tbody></table></div></section></div>' +
      '<section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>Suggested performance workflow</h2><p>Keep performance records consistent across the employee lifecycle.</p></div></div><div class="panel-body"><ol class="step-list"><li>Create an objective with a measurable target and review date.</li><li>Update the progress percentage as work advances.</li><li>Record a periodic review with the reviewer, rating and evidence.</li><li>Capture development areas and agreed next steps for the next period.</li></ol></div></section>';
  }

  function renderTraining() {
    var programs = hrArray('trainingPrograms');
    var rows = programs.map(function (t) { return '<tr><td><strong>' + esc(t.program || '—') + '</strong><small>' + esc(t.area || '') + '</small></td><td>' + esc(t.provider || '—') + '</td><td>' + esc(t.startDate || '—') + '</td><td>' + esc(t.endDate || '—') + '</td><td class="amount">' + esc(Number(t.employeeCount) || 0) + '</td><td><div class="progress-wrap"><div class="progress-track"><span style="width:' + Math.min(100, Math.max(0, Number(t.progress) || 0)) + '%"></span></div><small>' + esc(Number(t.progress) || 0) + '%</small></div></td><td><span class="badge badge-active">' + esc(t.status || 'Planned') + '</span></td><td><button class="mini-button" data-action="edit-training" data-id="' + esc(t.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-training" data-id="' + esc(t.id) + '" title="Delete">×</button></td></tr>'; }).join('');
    if (!rows) rows = '<tr><td colspan="8" class="empty-note">No training programmes yet. Add a programme to start tracking employee development.</td></tr>';
    return heading('Training', 'Organise training programmes and track the number of employees under training and progress.', '<button class="btn btn-primary" data-action="add-training">+ Add training programme</button>') +
      '<section class="panel"><div class="panel-header"><div><h2>Training programmes</h2><p>Record the programme, participating employee count, progress and dates.</p></div><span class="badge badge-active">' + programs.length + ' programmes</span></div><div class="table-wrap"><table><thead><tr><th>Training programme</th><th>Provider</th><th>Start</th><th>End</th><th>Employees under training</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>Training workflow</h2><p>Maintain a simple development record for each programme.</p></div></div><div class="panel-body"><ol class="step-list"><li>Add the training programme and provider.</li><li>Enter the number of employees currently under training.</li><li>Update progress as the programme continues.</li><li>Mark the programme completed or deferred and keep the history for HR reporting.</li></ol></div></section>';
  }

  /* ------------------------------------------------------------------ */
  /*  Modals for HR records (saved inside the settings document)         */
  /* ------------------------------------------------------------------ */

  function wireModal(backdrop) {
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { backdrop.remove(); }; });
    backdrop.onclick = function (ev) { if (ev.target === backdrop) backdrop.remove(); };
  }

  function upsert(arr, item) {
    var idx = arr.findIndex(function (x) { return x.id === item.id; });
    if (idx >= 0) arr[idx] = item; else arr.unshift(item);
  }

  function leaveModal(existing) {
    var r = existing || {}, catalog = leaveCatalog(), backdrop = document.createElement('div');
    var employeeId = r.employeeId || '', leaveType = r.leaveType || '';
    function entitlementFor(id) { var cat = catalog.find(function (c) { return c.id === id; }); return cat ? cat.entitlement : 'Select a leave type to view the statutory entitlement.'; }
    var leaveOpts = '<option value="">Select leave type</option>' + catalog.map(function (c) { return '<option value="' + esc(c.id) + '" ' + (c.id === leaveType ? 'selected' : '') + '>' + esc(c.name) + ' — ' + esc(c.section) + '</option>'; }).join('');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal tool-modal"><div class="modal-header"><div><p class="eyebrow">LEAVE MANAGEMENT</p><h2>' + (existing ? 'Edit leave record' : 'Assign employee leave') + '</h2></div><button class="modal-close" data-close>×</button></div><form id="leave-form"><div class="modal-body"><div class="form-grid">' +
      '<div class="field"><label>Employee</label><select id="leave-employee" required>' + employeeOptions(employeeId) + '</select></div>' +
      '<div class="field"><label>Leave type</label><select id="leave-type" required>' + leaveOpts + '</select></div>' +
      '<div class="field"><label>Statutory entitlement</label><input id="leave-entitlement" value="' + esc(entitlementFor(leaveType)) + '" readonly></div>' +
      field('leave-days', 'Days of leave', r.days == null ? 1 : r.days, 'number') + field('leave-start', 'Start date', r.startDate || '', 'date') + field('leave-end', 'End date', r.endDate || '', 'date') +
      '<div class="field"><label>Status</label><select id="leave-status"><option ' + (r.status === 'Pending' || !r.status ? 'selected' : '') + '>Pending</option><option ' + (r.status === 'Approved' ? 'selected' : '') + '>Approved</option><option ' + (r.status === 'Rejected' ? 'selected' : '') + '>Rejected</option></select></div>' +
      areaField('leave-reason', 'Reason / notes', r.reason || '') + '<div class="field"><label>HR approval / comment</label><textarea id="leave-comment">' + esc(r.comment || '') + '</textarea></div>' +
      '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save leave record</button></div></form></div>';
    wireModal(backdrop);
    var typeSelect = backdrop.querySelector('#leave-type'), entitlementInput = backdrop.querySelector('#leave-entitlement');
    typeSelect.onchange = function () { entitlementInput.value = entitlementFor(typeSelect.value); };
    backdrop.querySelector('#leave-form').onsubmit = function (ev) {
      ev.preventDefault();
      var emp = state.employees.find(function (e) { return e.id === $('#leave-employee').value; }), cat = catalog.find(function (c) { return c.id === $('#leave-type').value; });
      if (!emp || !cat) return;
      var days = Math.max(0, Number($('#leave-days').value) || 0);
      if (cat.maxDays != null && days > cat.maxDays) { toast('Days entered exceed the catalogue reference for ' + cat.name + '. Review the statutory conditions before saving.', true); return; }
      var item = { id: r.id || 'leave-' + Date.now(), employeeId: emp.id, employeeName: emp.name, employeeIdNumber: emp.employeeId || '', leaveType: cat.id, leaveName: cat.name, section: cat.section, entitlementText: cat.entitlement, days: days, startDate: $('#leave-start').value, endDate: $('#leave-end').value, status: $('#leave-status').value, reason: $('#leave-reason').value.trim(), comment: $('#leave-comment').value.trim() };
      upsert(hrArray('leaveRecords'), item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Leave record saved.');
    };
  }

  function objectiveModal(existing) {
    var o = existing || {}, backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal tool-modal"><div class="modal-header"><div><p class="eyebrow">PERFORMANCE MANAGEMENT</p><h2>' + (existing ? 'Edit objective' : 'Add employee objective') + '</h2></div><button class="modal-close" data-close>×</button></div><form id="objective-form"><div class="modal-body"><div class="form-grid"><div class="field"><label>Employee</label><select id="objective-employee" required>' + employeeOptions(o.employeeId) + '</select></div>' + field('objective-title', 'Objective title', o.title || '') + areaField('objective-description', 'Objective description', o.description || '') + field('objective-target', 'Target date', o.targetDate || '', 'date') + field('objective-progress', 'Progress %', o.progress == null ? 0 : o.progress, 'number') + '<div class="field"><label>Status</label><select id="objective-status"><option ' + (o.status === 'In progress' || !o.status ? 'selected' : '') + '>In progress</option><option ' + (o.status === 'On track' ? 'selected' : '') + '>On track</option><option ' + (o.status === 'At risk' ? 'selected' : '') + '>At risk</option><option ' + (o.status === 'Completed' ? 'selected' : '') + '>Completed</option><option ' + (o.status === 'Deferred' ? 'selected' : '') + '>Deferred</option></select></div>' + areaField('objective-notes', 'Progress notes', o.notes || '') + '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save objective</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector('#objective-form').onsubmit = function (ev) {
      ev.preventDefault();
      var emp = state.employees.find(function (e) { return e.id === $('#objective-employee').value; }); if (!emp) return;
      var item = { id: o.id || 'objective-' + Date.now(), employeeId: emp.id, employeeName: emp.name, title: $('#objective-title').value.trim(), description: $('#objective-description').value.trim(), targetDate: $('#objective-target').value, progress: Math.min(100, Math.max(0, Number($('#objective-progress').value) || 0)), status: $('#objective-status').value, notes: $('#objective-notes').value.trim() };
      if (!item.title) return;
      upsert(hrArray('performanceObjectives'), item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Performance objective saved.');
    };
  }

  function reviewModal(existing) {
    var r = existing || {}, backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal tool-modal"><div class="modal-header"><div><p class="eyebrow">PERFORMANCE REVIEW</p><h2>' + (existing ? 'Edit performance review' : 'Create performance review') + '</h2></div><button class="modal-close" data-close>×</button></div><form id="review-form"><div class="modal-body"><div class="form-grid"><div class="field"><label>Employee</label><select id="review-employee" required>' + employeeOptions(r.employeeId) + '</select></div>' + field('review-period', 'Review period', r.period || '') + field('review-date', 'Review date', r.reviewDate || '', 'date') + field('reviewer', 'Reviewer', r.reviewer || '') + '<div class="field"><label>Performance rating</label><select id="review-rating"><option ' + (r.rating === 'Not rated' || !r.rating ? 'selected' : '') + '>Not rated</option><option ' + (r.rating === 'Needs improvement' ? 'selected' : '') + '>Needs improvement</option><option ' + (r.rating === 'Meets expectations' ? 'selected' : '') + '>Meets expectations</option><option ' + (r.rating === 'Exceeds expectations' ? 'selected' : '') + '>Exceeds expectations</option></select></div>' + areaField('review-summary', 'Performance summary', r.summary || '') + areaField('review-achievements', 'Key achievements', r.achievements || '') + areaField('review-development', 'Development areas', r.development || '') + areaField('review-actions', 'Agreed actions / next steps', r.actions || '') + '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save performance review</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector('#review-form').onsubmit = function (ev) {
      ev.preventDefault();
      var emp = state.employees.find(function (e) { return e.id === $('#review-employee').value; }); if (!emp) return;
      var item = { id: r.id || 'review-' + Date.now(), employeeId: emp.id, employeeName: emp.name, period: $('#review-period').value.trim(), reviewDate: $('#review-date').value, reviewer: $('#reviewer').value.trim(), rating: $('#review-rating').value, summary: $('#review-summary').value.trim(), achievements: $('#review-achievements').value.trim(), development: $('#review-development').value.trim(), actions: $('#review-actions').value.trim() };
      upsert(hrArray('performanceReviews'), item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Performance review saved.');
    };
  }

  function trainingModal(existing) {
    var t = existing || {}, backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal tool-modal"><div class="modal-header"><div><p class="eyebrow">TRAINING</p><h2>' + (existing ? 'Edit training programme' : 'Add training programme') + '</h2></div><button class="modal-close" data-close>×</button></div><form id="training-form"><div class="modal-body"><div class="form-grid">' + field('training-program', 'Training programme', t.program || '') + field('training-provider', 'Provider / facilitator', t.provider || '') + field('training-area', 'Training area', t.area || '') + field('training-count', 'Number of employees under training', t.employeeCount == null ? 0 : t.employeeCount, 'number') + field('training-start', 'Start date', t.startDate || '', 'date') + field('training-end', 'End date', t.endDate || '', 'date') + field('training-progress', 'Progress %', t.progress == null ? 0 : t.progress, 'number') + '<div class="field"><label>Status</label><select id="training-status"><option ' + (t.status === 'Planned' || !t.status ? 'selected' : '') + '>Planned</option><option ' + (t.status === 'In progress' ? 'selected' : '') + '>In progress</option><option ' + (t.status === 'Completed' ? 'selected' : '') + '>Completed</option><option ' + (t.status === 'Deferred' ? 'selected' : '') + '>Deferred</option></select></div>' + areaField('training-notes', 'Notes', t.notes || '') + '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save training programme</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector('#training-form').onsubmit = function (ev) {
      ev.preventDefault();
      var item = { id: t.id || 'training-' + Date.now(), program: $('#training-program').value.trim(), provider: $('#training-provider').value.trim(), area: $('#training-area').value.trim(), employeeCount: Math.max(0, Number($('#training-count').value) || 0), startDate: $('#training-start').value, endDate: $('#training-end').value, progress: Math.min(100, Math.max(0, Number($('#training-progress').value) || 0)), status: $('#training-status').value, notes: $('#training-notes').value.trim() };
      if (!item.program) return;
      upsert(hrArray('trainingPrograms'), item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Training programme saved.');
    };
  }

  function renderJobs() {
    var jobs = asArray(state.settings.jobDescriptions);
    var rows = jobs.map(function (j) { return '<tr><td><strong>' + esc(j.title) + '</strong><small>' + esc(j.department || '') + '</small></td><td>' + esc(j.reportsTo || '—') + '</td><td>' + esc(j.location || '—') + '</td><td><button class="mini-button" data-action="edit-job" data-id="' + esc(j.id) + '" title="Edit">✎</button><button class="mini-button" data-action="delete-job" data-id="' + esc(j.id) + '" title="Delete">×</button></td></tr>'; }).join('');
    if (!rows) rows = '<tr><td colspan="4" class="empty-note">No job descriptions yet. Create one to build your HR role library.</td></tr>';
    return heading('Job Descriptions', 'Create detailed, reusable job descriptions for positions in your organisation.', '<button class="btn btn-primary" data-action="add-job">+ Create job description</button>') +
      '<section class="panel"><div class="panel-header"><div><h2>Job description library</h2><p>Enter the role details once and keep the approved version available to HR.</p></div></div><div class="table-wrap"><table><thead><tr><th>Position</th><th>Reports to</th><th>Location</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<div class="dashboard-grid" style="margin-top:15px"><section class="panel"><div class="panel-header"><div><h2>Recommended fields</h2><p>Use the form to capture the complete role profile.</p></div></div><div class="panel-body"><ul class="detail-list"><li>Job title and department</li><li>Job purpose and key responsibilities</li><li>Education, experience and technical skills</li><li>Behavioural competencies</li><li>Reports to and working location</li><li>KPIs / performance measures</li><li>Approval and review date</li></ul></div></section><section class="panel"><div class="panel-header"><div><h2>HR use</h2><p>Connect the description to recruitment, onboarding and performance management.</p></div></div><div class="panel-body"><ol class="step-list"><li>Draft the role profile.</li><li>Review it with the responsible manager.</li><li>Approve and publish the description.</li><li>Use the same requirements in recruitment.</li><li>Review it when the role materially changes.</li></ol></div></section></div>';
  }

  function renderPeople() {
    return heading("People", "Manage the employees used in payroll calculations.", '<button class="btn btn-primary" data-action="add-employee"><span class="button-symbol">+</span> Add employee</button>') +
      '<section class="panel"><div class="toolbar"><div class="toolbar-left"><div class="search-box"><span class="search-symbol">⌕</span><input id="employee-search" placeholder="Search employees"></div></div><div class="toolbar-right"><span class="mono">' + state.employees.length + ' records</span></div></div><div id="people-table">' + employeeTable(state.employees) + '</div></section>';
  }

  function renderPayroll() {
    var total = state.employees.reduce(function (s, e) { return s + Number(e.salary || 0); }, 0);
    return heading("Payroll", "Process payroll using the Zambia statutory calculator.", '<div class="heading-actions-inline"><button class="btn btn-secondary" data-action="open-calculator">Open pay calculator</button><button class="btn btn-primary" data-action="run-payroll">Record payroll run</button></div>') +
      '<section class="panel"><div class="summary-strip">' +
      summary("Employees", state.employees.length) + summary("Gross", money(total)) + summary("PAYE", (state.settings.rates && state.settings.rates.PAYE) || "Not set") + summary("Runs", state.payrolls.length) +
      '</div>' + payrollTable() + '</section>';
  }

  function summary(label, value) { return '<div class="summary-item"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }

  function payrollTable() {
    if (!state.payrolls.length) return '<div class="empty-state"><div class="empty-icon">▤</div><h3>No payroll runs</h3><p>Add employees, then press “Record payroll run”.</p></div>';
    return '<div class="table-wrap"><table><thead><tr><th>Period</th><th>Employees</th><th>Gross</th><th>Net pay</th><th>Employer cost</th><th>Recorded</th><th>Status</th></tr></thead><tbody>' +
      state.payrolls.map(function (p) { return '<tr><td>' + esc(p.period) + '</td><td>' + esc(p.employeeCount) + '</td><td class="amount">' + money(p.gross) + '</td><td class="amount">' + money(p.net) + '</td><td class="amount">' + money(p.employerCost || p.gross) + '</td><td>' + esc(fmtDate(p.createdAt)) + '</td><td><span class="badge badge-complete">Completed</span></td></tr>'; }).join("") +
      '</tbody></table></div>';
  }

  /* ------------------------------------------------------------------ */
  /*  Payroll calculation                                                */
  /* ------------------------------------------------------------------ */

  // Firestore rejects nested arrays and Infinity, so PAYE bands are stored as
  // [{ upTo: number|null, rate }] (null = no upper limit). Legacy [[limit, rate]] data is converted.
  function normalizePayeBands(bands) {
    var def = [{ upTo: 5100, rate: 0 }, { upTo: 7100, rate: 0.20 }, { upTo: 9200, rate: 0.30 }, { upTo: null, rate: 0.37 }];
    if (!Array.isArray(bands) || !bands.length) return def;
    var out = bands.map(function (b) {
      var limit, rate;
      if (Array.isArray(b)) { limit = b[0]; rate = b[1]; }
      else if (b && typeof b === "object") { limit = b.upTo; rate = b.rate; }
      else return null;
      limit = (limit === null || limit === undefined || limit === "" || !isFinite(Number(limit))) ? null : Number(limit);
      return { upTo: limit, rate: Number(rate) || 0 };
    }).filter(Boolean);
    return out.length ? out : def;
  }

  function calculatePaye(chargeable) {
    var x = Math.max(0, Number(chargeable) || 0), tax = 0, prev = 0;
    var rules = state.settings.payrollRules || {};
    var bands = normalizePayeBands(rules.paye && rules.paye.bands);
    for (var i = 0; i < bands.length; i++) {
      var limit = bands[i].upTo === null ? Infinity : bands[i].upTo, rate = bands[i].rate;
      var slice = Math.max(0, Math.min(x, limit) - prev);
      tax += slice * rate;
      prev = limit;
      if (x <= limit) break;
    }
    return tax;
  }

  function calculatePayroll(basic, allowances, overtime, bonus, otherDeductions, housing, food) {
    var b = Math.max(0, Number(basic) || 0);
    var a = Math.max(0, Number(allowances) || 0);
    var hse = Math.max(0, Number(housing) || 0);
    var f = Math.max(0, Number(food) || 0);
    var o = Math.max(0, Number(overtime) || 0);
    var bo = Math.max(0, Number(bonus) || 0);
    var od = Math.max(0, Number(otherDeductions) || 0);
    var gross = b + hse + f + a + o + bo;
    var additions = hse + f + a + o + bo;
    var rules = state.settings.payrollRules || {};
    var n = rules.napsa || { employeeRate: .05, employerRate: .05, ceiling: 28920.30 };
    var h = rules.nhima || { employeeRate: .01, employerRate: .01, basis: "basic" };
    var sd = rules.sdl || { employerRate: .005 };
    var w = rules.wcfcb || { employerRate: 0 };
    var napsaBase = Math.min(gross, Number(n.ceiling) || 28920.30);
    var napsaEmployee = napsaBase * Number(n.employeeRate || .05);
    var napsaEmployer = napsaBase * Number(n.employerRate || .05);
    var nhimaBase = h.basis === "basic" ? b : gross;
    var nhimaEmployee = nhimaBase * Number(h.employeeRate || .01);
    var nhimaEmployer = nhimaBase * Number(h.employerRate || .01);
    var paye = calculatePaye(gross);
    var employeeDeductions = paye + napsaEmployee + nhimaEmployee + od;
    var net = Math.max(0, gross - employeeDeductions);
    var sdl = gross * Number(sd.employerRate || 0.005);
    var wcf = gross * Number(w.employerRate || 0);
    return {
      basic: b, housing: hse, food: f, allowances: a, overtime: o, bonus: bo, additions: additions, gross: gross,
      paye: paye, napsaEmployee: napsaEmployee, napsaEmployer: napsaEmployer, nhimaEmployee: nhimaEmployee, nhimaEmployer: nhimaEmployer,
      sdl: sdl, wcfcb: wcf, otherDeductions: od, totalEmployeeDeductions: employeeDeductions, totalDeductions: employeeDeductions,
      net: net, employerCost: gross + napsaEmployer + nhimaEmployer + sdl + wcf
    };
  }

  function calculatorFormMarkup() {
    var options = '<option value="">Manual calculation</option>' + state.employees.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + ' — ' + esc(e.employeeId || 'No ID') + '</option>'; }).join('');
    return '<section class="panel calculator-panel"><div class="panel-header"><div><h2>Employee pay calculator</h2><p>Calculate pay and generate the employee payslip from the same calculation.</p></div><span class="badge badge-active">ZMW</span></div><div class="panel-body"><div class="form-grid three">' +
      '<div class="field"><label for="calc-employee">Employee</label><select id="calc-employee">' + options + '</select></div>' +
      field("calc-period", "Pay period", new Date().toISOString().slice(0, 7), "month") +
      field("calc-basic", "Basic salary", "", "number") +
      field("calc-housing", "Housing allowance", 0, "number") +
      field("calc-food", "Food allowance", 0, "number") +
      field("calc-allowances", "Other taxable allowances", 0, "number") +
      field("calc-overtime", "Overtime / leave pay", 0, "number") +
      field("calc-bonus", "Bonus / commission", 0, "number") +
      field("calc-other", "Other employee deductions", 0, "number") +
      areaField("calc-signed-by", "Signed by", "") +
      '</div><div class="form-section"><h3>Payment method</h3><div class="check-options" id="payment-method-options"><label class="check-option"><input id="calc-cash" type="checkbox"> Cash</label><label class="check-option"><input id="calc-cheque" type="checkbox"> Cheque</label></div><p class="form-hint">Select the method used to pay the employee. The payslip will mark the selected option.</p></div><div id="calculator-results" class="calculator-results"></div></div></section>';
  }

  function renderCalculator() {
    return heading("Pay calculator", "Calculate gross pay, statutory deductions, net pay and employer cost before recording payroll.", '<button class="btn btn-secondary" data-view="payroll">Back to payroll</button>') + calculatorFormMarkup();
  }

  function calculatorResults() {
    var c = calculatePayroll($("#calc-basic").value, $("#calc-allowances").value, $("#calc-overtime").value, $("#calc-bonus").value, $("#calc-other").value, $("#calc-housing").value, $("#calc-food").value);
    var employee = state.employees.find(function (e) { return e.id === $("#calc-employee").value; });
    return '<div class="calculator-summary"><div class="calc-card"><span>Gross pay</span><strong>' + money(c.gross) + '</strong></div><div class="calc-card"><span>Total additions</span><strong>' + money(c.additions) + '</strong></div><div class="calc-card"><span>PAYE</span><strong>' + money(c.paye) + '</strong></div><div class="calc-card"><span>Employee NAPSA</span><strong>' + money(c.napsaEmployee) + '</strong></div><div class="calc-card"><span>Employee NHIMA</span><strong>' + money(c.nhimaEmployee) + '</strong></div><div class="calc-card"><span>Total deductions</span><strong>' + money(c.totalDeductions) + '</strong></div><div class="calc-card net"><span>Net pay</span><strong>' + money(c.net) + '</strong></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Payroll item</th><th>Employee</th><th>Employer</th></tr></thead><tbody>' +
      '<tr><td>PAYE</td><td class="amount">' + money(c.paye) + '</td><td>—</td></tr><tr><td>NAPSA</td><td class="amount">' + money(c.napsaEmployee) + '</td><td class="amount">' + money(c.napsaEmployer) + '</td></tr><tr><td>NHIMA</td><td class="amount">' + money(c.nhimaEmployee) + '</td><td class="amount">' + money(c.nhimaEmployer) + '</td></tr><tr><td>Skills Development Levy</td><td>—</td><td class="amount">' + money(c.sdl) + '</td></tr><tr><td>WCFCB estimate</td><td>—</td><td class="amount">' + money(c.wcfcb) + '</td></tr><tr><td>Other employee deductions</td><td class="amount">' + money(c.otherDeductions) + '</td><td>—</td></tr><tr><td><strong>Employer cost</strong></td><td></td><td class="amount"><strong>' + money(c.employerCost) + '</strong></td></tr></tbody></table></div>' +
      '<section class="payslip-preview-panel"><div class="panel-header"><div><h3>Payslip additions & deductions</h3><p>The same calculation will be used for the generated payslip.</p></div></div><div class="payslip-meta-summary"><div><span>Payment</span><strong>' + ($("#calc-cash") && $("#calc-cash").checked ? 'Cash' : ($("#calc-cheque") && $("#calc-cheque").checked ? 'Cheque' : 'Not selected')) + '</strong></div><div><span>Signed by</span><strong>' + esc($("#calc-signed-by") ? $("#calc-signed-by").value : '') + '</strong></div><div><span>Salary in words</span><strong>' + esc(amountInWords(c.net)) + '</strong></div></div></section>' +
      '<div class="payslip-actions"><button class="btn btn-primary" data-action="print-payslip">Print / Save PDF</button><button class="btn btn-secondary" data-action="download-payslip">Download payslip</button><button class="btn btn-secondary" data-action="share-payslip">Share payslip</button></div>' +
      '<p class="footer-note">' + (employee ? 'Payslip ready for ' + esc(employee.name) + '. ' : '') + 'PAYE is calculated on gross taxable emoluments. NAPSA is capped at the configured ceiling. NHIMA is calculated on basic salary in this version. WCFCB is left at the employer-configured rate because assessments vary by industry.</p>';
  }

  function statutoryOverview() {
    var agencies = state.settings.agencies || [];
    return '<section class="panel agency-dashboard"><div class="panel-header"><div><h2>Statutory & business agencies</h2><p>Official reference points and workspace compliance data.</p></div><button class="text-link" data-view="statutory">Open statutory centre</button></div><div class="panel-body"><div class="agency-links">' + agencies.map(function (a) { return '<a class="agency-link" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + agencyLogoMarkup(a, true) + '<span><strong>' + esc(a.name) + '</strong><small>' + esc(a.role) + '</small></span><span>↗</span></a>'; }).join('') + '</div></div></section>';
  }

  // Must be global because it is called from an inline onerror="" attribute.
  window.handleAgencyLogoError = function (img) {
    if (img.dataset.fallback && img.src.indexOf(img.dataset.fallback) === -1) {
      img.src = img.dataset.fallback;
    } else {
      img.style.display = "none";
      if (img.parentNode) img.parentNode.classList.add("logo-fallback");
    }
  };

  function agencyLogoMarkup(a, large) {
    var src = a.logo || a.fallbackLogo || '';
    var fallback = a.fallbackLogo || '';
    return '<span class="agency-logo-wrap ' + (large ? 'large' : '') + '"><img class="agency-logo' + (large ? ' agency-logo-large' : '') + '" src="' + esc(src) + '" data-fallback="' + esc(fallback) + '" alt="' + esc(a.code) + ' logo" onerror="handleAgencyLogoError(this)"><span class="agency-logo-fallback-text">' + esc(a.code) + '</span></span>';
  }

  function renderStatutory() {
    var r = state.settings.payrollRules;
    var updates = asArray(state.statutoryUpdates);
    return heading("Statutory centre", "Payroll rules plus PACRA, ZDA and ZEMA business-compliance records.", '<button class="btn btn-primary" data-action="save-statutory">Save statutory settings</button>') +
      '<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Payroll rules</h2><p>Effective rules used by the calculator.</p></div></div><div class="panel-body"><div class="form-grid three">' + field("stat-year", "Tax year", state.settings.taxYear || 2026, "number") + field("stat-napsa-ceiling", "NAPSA monthly ceiling", r.napsa.ceiling, "number") + field("stat-nhima-rate", "NHIMA employee %", r.nhima.employeeRate * 100, "number") + field("stat-napsa-rate", "NAPSA employee %", r.napsa.employeeRate * 100, "number") + field("stat-sdl-rate", "SDL employer %", r.sdl.employerRate * 100, "number") + field("stat-wcf-rate", "WCFCB estimate %", r.wcfcb.employerRate * 100, "number") + '</div><div class="notice info"><span class="notice-icon">i</span><div><strong>Source-controlled design</strong>Payroll rules are stored separately so an approved future update can change the calculator without rewriting employee records.</div></div></div></section><aside class="panel"><div class="panel-header"><div><h2>Agency records</h2><p>Track your company’s registration/compliance details.</p></div></div><div class="panel-body">' + agencyRecordForm() + '</div></aside></div><section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2>Update log</h2><p>Record the source and effective date whenever a statutory rule changes.</p></div></div>' + (updates.length ? '<div class="table-wrap"><table><thead><tr><th>Agency</th><th>Update</th><th>Effective</th><th>Source</th></tr></thead><tbody>' + updates.map(function (u) { return '<tr><td>' + esc(u.agency) + '</td><td>' + esc(u.update) + '</td><td>' + esc(u.effective || '—') + '</td><td><a href="' + esc(u.source || '#') + '" target="_blank" rel="noopener">Open source</a></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty-note">No custom statutory updates recorded yet.</div>') + '</section>';
  }

  function agencyRecordForm() {
    var a = state.settings.agencyRecords || {};
    return '<div class="form-grid">' + field("rec-pacra", "PACRA status / number", a.PACRA || "") + field("rec-zda", "ZDA status / certificate", a.ZDA || "") + field("rec-zema", "ZEMA status / licence", a.ZEMA || "") + field("rec-zra", "ZRA TPIN / PAYE", a.ZRA || "") + field("rec-napsa", "NAPSA employer number", a.NAPSA || "") + field("rec-nhima", "NHIMA employer number", a.NHIMA || "") + field("rec-wcfcb", "WCFCB employer number", a.WCFCB || "") + '</div><div class="form-grid" style="margin-top:14px">' + field("update-agency", "Agency", "") + field("update-effective", "Effective date", "", "date") + '</div><div class="field" style="margin-top:14px"><label>Update note</label><textarea id="update-note" placeholder="Describe the change and why it applies."></textarea></div><div class="field" style="margin-top:14px"><label>Official source URL</label><input id="update-source" placeholder="https://..."></div><button class="btn btn-secondary" style="margin-top:12px" data-action="add-statutory-update">Add update to log</button>';
  }

  function renderCompliance() {
    var policies = [
      ["Employment contracts", "Maintain written contracts, employee particulars, contract dates and signed records.", "High", "contracts"],
      ["Payslips & payroll records", "Keep clear payroll calculations, deductions, payslips and payment records for each payroll period.", "High", "payslips"],
      ["Employment policies", "Maintain accessible workplace policies covering conduct, discipline, grievance handling, leave and other applicable HR controls.", "High", "policies"],
      ["Working hours", "Monitor working hours, overtime and rest arrangements against applicable employment requirements.", "High", "hours"],
      ["Leave & maternity", "Maintain annual leave and maternity-related records and ensure statutory protections are observed.", "High", "leave"],
      ["Labour statistics", "Keep employment relationship information and required labour-statistics submissions current.", "Medium", "statistics"],
      ["Wages", "Monitor wages, allowances and deductions against applicable employment requirements and documented terms.", "High", "wages"],
      ["PAYE & SDL", "Deduct and account for PAYE correctly and track employer Skills Development Levy obligations.", "High", "tax"],
      ["NAPSA", "Register employees, calculate contributions correctly and maintain contribution schedules and payment records.", "High", "napsa"],
      ["NHIMA", "Register employees and maintain monthly health-insurance contribution records and returns.", "High", "nhima"],
      ["Workers compensation", "Maintain WCFCB registration and employer assessment compliance.", "High", "wcfcb"]
    ];
    return heading("HR & employer compliance", "A readable HR control centre for contracts, payroll, labour requirements and statutory obligations.", '<button class="btn btn-primary" data-view="statutory">Manage statutory data</button>') +
      '<div class="stat-grid">' + stat("Employees", state.employees.length, "Records in workspace") + stat("Contracts recorded", state.employees.filter(function (e) { return !!e.contractStart; }).length, "Add contract dates to employee records") + stat("Payroll runs", state.payrolls.length, "Audit trail") + stat("Rules year", state.settings.taxYear || 2026, "Payroll rules") + '</div>' +
      '<section class="panel compliance-panel"><div class="panel-header"><div><h2>Employer compliance checklist</h2><p>Click <strong>Review</strong> on any control to read the requirement, what HR should keep, and the related statutory area.</p></div></div><div class="compliance-list">' +
      policies.map(function (p) { return '<div class="compliance-row"><div class="compliance-main"><div class="compliance-title"><strong>' + esc(p[0]) + '</strong><span class="badge ' + (p[2] === 'High' ? 'badge-error' : 'badge-draft') + '">' + p[2] + '</span></div><p>' + esc(p[1]) + '</p></div><button class="btn btn-secondary compliance-review" data-action="review-compliance" data-key="' + esc(p[3]) + '">Review</button></div>'; }).join('') +
      '</div></section><p class="footer-note">Use this dashboard as an HR control list. Keep source links and effective dates current when laws or administrative requirements change.</p>';
  }

  function complianceModal(key) {
    var details = {
      contracts: { title: "Employment contracts", summary: "Prepare and retain employment contracts and provide the employee with the required copy. The Employment Code Act regulates contracts and employment entitlements; the Ministry also publishes an employment-contract attestation service.", steps: ["Confirm the role, employment type, start date, remuneration and reporting arrangements.", "Prepare the written employment contract using the organisation's approved template and applicable law.", "Give the employee the required copy and retain the employer copy.", "Where attestation/approval applies, submit through the applicable Labour Ministry process and retain evidence.", "Record amendments whenever a material employment term changes."], keep: ["Signed contract", "Employee copy / acknowledgement", "Attestation evidence where applicable", "Amendments and review history"], source: "https://www.mlss.gov.zm/?page_id=1718" },
      payslips: { title: "Payslips & payroll records", summary: "Maintain payroll records that allow HR to trace gross pay, deductions, statutory contributions and net pay for every payroll period.", steps: ["Confirm employee master data before processing payroll.", "Calculate gross earnings and applicable deductions.", "Review PAYE, NAPSA, NHIMA and other applicable deductions.", "Approve and process the payroll run.", "Generate the payslip and provide it to the employee.", "Retain payroll registers, payslips, returns and payment evidence."], keep: ["Payroll register", "Payslip", "Calculation record", "Statutory return/payment evidence"], source: "https://www.parliament.gov.zm/node/7948" },
      policies: { title: "Employment policies", summary: "Maintain clear workplace policies and procedures appropriate to the organisation and communicate controlled versions to employees.", steps: ["Identify policies required for the organisation and workforce.", "Draft or review each policy against applicable employment requirements.", "Obtain management approval and record the effective date.", "Communicate the approved policy to employees.", "Keep a controlled copy and review it when law or organisational requirements change."], keep: ["Approved policy", "Version number", "Effective date", "Communication record"], source: "https://www.parliament.gov.zm/node/7948" },
      hours: { title: "Working hours", summary: "Record ordinary working time, overtime and relevant rest arrangements, and keep approvals for exceptions.", steps: ["Define normal working schedules for each applicable employee group.", "Record attendance or working time using the approved method.", "Record and approve overtime where it occurs.", "Cross-check approved working time against payroll inputs.", "Investigate and document material exceptions."], keep: ["Work schedules", "Attendance/time records", "Overtime approvals", "Payroll cross-checks"], source: "https://zambialii.org/akn/zm/act/2019/3/eng@2019-04-12" },
      leave: { title: "Leave & maternity", summary: "Maintain leave requests, approvals, balances and maternity-related records in an auditable employee file.", steps: ["Set up leave categories and the approval workflow.", "Record each employee's entitlement and balance.", "Capture requests and approval decisions.", "Update balances after approved leave is taken.", "Maintain maternity-related records confidentially and apply the relevant statutory protections."], keep: ["Leave policy", "Leave request", "Approval record", "Leave balance", "Maternity records where applicable"], source: "https://www.parliament.gov.zm/node/7948" },
      statistics: { title: "Labour statistics", summary: "Keep current employment relationship information so required labour-statistics reporting can be prepared from accurate HR records.", steps: ["Maintain a current employee register.", "Keep employment dates, status, job and required workforce fields up to date.", "Review the dataset before submission.", "Submit required statistics through the applicable Labour Ministry process.", "Retain the submitted report and supporting records."], keep: ["Employee register", "Reporting dataset", "Submission evidence", "Corrections/history"], source: "https://www.mlss.gov.zm/?page_id=2951" },
      wages: { title: "Wages", summary: "Document agreed remuneration and process wages and deductions consistently with employee terms and applicable requirements.", steps: ["Confirm approved salary and allowances.", "Record authorised changes before payroll is processed.", "Calculate gross pay and lawful/authorised deductions.", "Generate and issue the payslip.", "Reconcile payroll totals to payment instructions and records."], keep: ["Contract/remuneration record", "Approved salary changes", "Payslip", "Payroll register", "Payment evidence"], source: "https://www.parliament.gov.zm/node/7948" },
      tax: { title: "PAYE & SDL", summary: "Run PAYE through payroll and track the employer's Skills Development Levy obligations using current approved tax parameters.", steps: ["Maintain employee tax/payroll information.", "Calculate taxable emoluments and PAYE using the current ZRA rules configured in Statutory Centre.", "Deduct PAYE from the employee where applicable.", "Calculate employer Skills Development Levy using the applicable rule.", "Submit the required return and payment by the applicable due date.", "Retain return and payment evidence."], keep: ["PAYE calculation", "Payroll register", "PAYE/SDL return", "Payment confirmation"], source: "https://www.zra.org.zm/" },
      napsa: { title: "NAPSA", summary: "Register the employer and eligible employees, calculate contributions, file returns and keep contribution evidence.", steps: ["Confirm employer registration with NAPSA.", "Register eligible employees and maintain member details.", "Calculate employee and employer contributions using current NAPSA parameters.", "Prepare the monthly contribution return.", "Submit the return and payment through the applicable NAPSA channel by the due date.", "Reconcile payroll deductions to the NAPSA return and payment."], keep: ["Employer account", "Employee NAPSA numbers", "Contribution schedule", "Return", "Payment evidence"], source: "https://www.napsa.co.zm/enapsa/" },
      nhima: { title: "NHIMA", summary: "Maintain employee registration and monthly National Health Insurance contribution records and retain return/payment evidence.", steps: ["Confirm the employer account is active with NHIMA.", "Register eligible employees through the applicable NHIMA process.", "Calculate employee and employer contributions using the current rule.", "Prepare the monthly return.", "Remit contributions by the applicable due date.", "Reconcile deductions, employer contribution, return and payment evidence."], keep: ["Employer account", "Employee registration", "Contribution schedule", "Return", "Payment evidence"], source: "https://enhima.nhima.co.zm/employee/home" },
      wcfcb: { title: "Workers compensation", summary: "Maintain WCFCB registration and assessment records. The applicable assessment can depend on industry/risk, so the rate remains configurable.", steps: ["Confirm WCFCB registration status.", "Keep declared workforce and earnings information current.", "Confirm the applicable assessment for the organisation's industry/risk category.", "Record the assessment and payment evidence.", "Review workforce or earnings changes and update the record when required."], keep: ["WCFCB registration", "Assessment notice/rate", "Declared workforce/earnings", "Payment evidence"], source: "https://www.workers.com.zm/" }
    };
    var d = details[key] || { title: "Compliance review", summary: "Review the applicable HR requirement and keep evidence of the organisation's actions.", steps: ["Identify the requirement.", "Complete the required HR action.", "Record the evidence.", "Review it periodically."], keep: ["Current record", "Supporting evidence", "Responsible HR officer"], source: "https://www.mlss.gov.zm/" };
    var steps = d.steps.map(function (x, i) { return '<li><span class="step-number">' + (i + 1) + '</span><div>' + esc(x) + '</div></li>'; }).join('');
    var keep = d.keep.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var back = '<div class="modal-backdrop" id="compliance-modal"><div class="modal compliance-modal"><div class="modal-header"><div><p class="eyebrow">HR COMPLIANCE REVIEW</p><h2>' + esc(d.title) + '</h2></div><button class="modal-close" data-action="close-compliance">×</button></div><div class="modal-body"><p class="compliance-detail">' + esc(d.summary) + '</p><section class="compliance-step-section"><h3>Step-by-step process</h3><ol class="compliance-steps">' + steps + '</ol></section><div class="compliance-review-grid"><div><strong>Evidence HR should keep</strong><ul>' + keep + '</ul></div><div><strong>Where to manage it in HR Payroll</strong><ul><li>People — employee records</li><li>Payroll / Calculator — payroll evidence</li><li>Statutory — rates and agency records</li><li>Reports — workforce/payroll summaries</li></ul></div></div><a class="btn btn-secondary compliance-source" href="' + esc(d.source) + '" target="_blank" rel="noopener">Open official reference</a></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', back);
    var close = $("#compliance-modal .modal-close"); if (close) close.onclick = function () { var m = $("#compliance-modal"); if (m) m.remove(); };
  }

  function renderReports() {
    var gross = state.employees.reduce(function (s, e) { return s + Number(e.salary || 0); }, 0);
    var departments = {};
    state.employees.forEach(function (e) { departments[e.department || "Unassigned"] = (departments[e.department || "Unassigned"] || 0) + 1; });
    var deptHtml = Object.keys(departments).map(function (d) { return '<p><strong>' + esc(d) + '</strong> — ' + departments[d] + ' employee(s)</p>'; }).join("") || '<p class="empty-note">No employee data yet.</p>';
    return heading("Reports", "Simple payroll and workforce summaries for the current workspace.", '<button class="btn btn-secondary" data-action="backup">Download backup</button>') +
      '<div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Workforce summary</h2><p>Current employee records</p></div></div><div class="panel-body">' +
      '<div class="summary-strip">' + summary("Headcount", state.employees.length) + summary("Gross / month", money(gross)) + summary("Departments", Object.keys(departments).length) + summary("Payroll runs", state.payrolls.length) + '</div>' +
      '<div class="panel-body">' + deptHtml + '</div></div></section>' +
      '<section class="panel"><div class="panel-header"><div><h2>Data status</h2><p>Workspace storage</p></div></div><div class="panel-body"><div class="notice info"><span class="notice-icon">i</span><div><strong>' + (state.cloud ? (state.loadError ? "Firebase connected — data could not be read" : "Firebase connected") : "Local demo mode") + '</strong> ' + (state.cloud ? (state.loadError ? esc(state.loadError) : "Your workspace is stored in Cloud Firestore.") : "Data is stored in this browser until Firebase is configured.") + '</div></div></div></section></div>';
  }

  function renderSettings() {
    var r = state.settings.rates || {};
    return heading("Settings", "Company profile and statutory payroll rules.", '<button class="btn btn-primary" data-action="save-settings">Save settings</button>') +
      '<div class="settings-layout"><section class="panel"><div class="settings-card"><h2>Company profile</h2><p>These details identify the payroll workspace.</p><div class="form-grid">' +
      field("company-name-setting", "Company name", state.settings.companyName || "") +
      field("pacra-number-setting", "PACRA company registration number", state.settings.pacraRegistrationNumber || "") +
      field("tax-year-setting", "Tax year", state.settings.taxYear || 2026, "number") +
      '</div></div><div class="settings-card"><div class="section-title"><h3>Organization hierarchy</h3><button class="btn btn-secondary hierarchy-add" data-action="add-hierarchy-role">Add role</button></div><p>Add each position, the person holding it, and who they report to.</p><div class="hierarchy-settings-list">' + organizationHierarchySettingsMarkup() + '</div></div><div class="settings-card"><div class="section-title"><h3>Statutory rates</h3></div>' +
      '<div class="form-grid">' + field("rate-paye", "PAYE", r.PAYE || "Not set") + field("rate-napsa", "NAPSA", r.NAPSA || "Not set") + field("rate-nhima", "NHIMA", r.NHIMA || "Not set") + field("rate-sdl", "SDL / SDC", r["SDL / SDC"] || "Not set") + field("rate-wcfcb", "WCFCB", r.WCFCB || "Not set") + '</div></div></section>' +
      '<aside class="panel"><div class="settings-card"><h2>Firebase status</h2><p>' + (state.cloud ? "Connected to Firebase Authentication and Cloud Firestore." : "Firebase is not configured. The app is running in local demo mode.") + '</p>' + (state.loadError ? '<div class="notice info"><span class="notice-icon">!</span><div><strong>Last load error</strong> ' + esc(state.loadError) + '</div></div>' : '') + '<div class="notice info"><span class="notice-icon">i</span><div>Use the Firebase Web App configuration in <code>firebase-config.js</code> for real cloud storage.</div></div></div></aside></div>';
  }

  function organizationHierarchyMarkup() {
    var roles = asArray(state.settings.organizationHierarchy);
    var children = roles.map(function () { return []; });
    var roots = [];
    var visited = {};
    roles.forEach(function (item, index) {
      var manager = String(item.reportsTo || "").trim().toLowerCase();
      var parent = manager ? roles.findIndex(function (candidate, candidateIndex) {
        return candidateIndex !== index && (String(candidate.name || "").trim().toLowerCase() === manager || String(candidate.role || "").trim().toLowerCase() === manager);
      }) : -1;
      if (parent < 0) roots.push(index);
      else children[parent].push(index);
    });
    function renderBranch(index) {
      if (visited[index]) return "";
      visited[index] = true;
      var item = roles[index];
      var portrait = item.photo ? '<img src="' + esc(item.photo) + '" alt="">' : '<span>' + esc(initials(item.name || item.role)) + '</span>';
      var card = '<article class="hierarchy-person"><div class="hierarchy-avatar">' + portrait + '</div><div class="hierarchy-person-copy"><strong>' + esc(item.name || "Position holder") + '</strong><span>' + esc(item.role || "Role") + '</span></div></article>';
      var reports = children[index].map(renderBranch).join("");
      return '<div class="hierarchy-branch">' + card + (reports ? '<div class="hierarchy-children' + (children[index].length > 1 ? ' has-siblings' : '') + '">' + reports + '</div>' : '') + '</div>';
    }
    var tree = roots.map(renderBranch).join("");
    roles.forEach(function (_, index) { if (!visited[index]) tree += renderBranch(index); });
    return '<div class="dashboard-org-chart"><h2>Organization hierarchy</h2>' + (tree ? '<div class="hierarchy-tree">' + tree + '</div>' : '<p>Add roles in Company settings to show your organization hierarchy.</p>') + '</div>';
  }

  function organizationHierarchySettingsMarkup() {
    var roles = asArray(state.settings.organizationHierarchy);
    if (!roles.length) return '<p class="hierarchy-empty">No roles added yet.</p>';
    return roles.map(function (item, index) {
      var portrait = item.photo ? '<img src="' + esc(item.photo) + '" alt="">' : '<span>Photo</span>';
      return '<div class="hierarchy-edit-row" data-hierarchy-row data-photo="' + esc(item.photo || '') + '"><div class="hierarchy-edit-avatar hierarchy-avatar">' + portrait + '</div><div class="field"><label>Role / position</label><input class="hierarchy-role" type="text" value="' + esc(item.role || '') + '"></div><div class="field"><label>Person</label><input class="hierarchy-name" type="text" value="' + esc(item.name || '') + '"></div><div class="field"><label>Reports to (role or person)</label><input class="hierarchy-manager" type="text" value="' + esc(item.reportsTo || '') + '"></div><div class="hierarchy-photo-control"><label class="btn btn-secondary hierarchy-upload">Upload photo<input class="hierarchy-photo-input" type="file" accept="image/*" aria-label="Upload photo for role ' + (index + 1) + '"></label></div><button class="remove-row hierarchy-remove" data-action="remove-hierarchy-role" aria-label="Remove role">×</button></div>';
    }).join("");
  }

  function addHierarchyRole() {
    syncOrganizationHierarchy();
    state.settings.organizationHierarchy = state.settings.organizationHierarchy || [];
    state.settings.organizationHierarchy.push({ role: "", name: "", reportsTo: "", photo: "" });
    var list = $(".hierarchy-settings-list");
    var empty = list.querySelector(".hierarchy-empty");
    if (empty) empty.remove();
    var holder = document.createElement("div");
    holder.innerHTML = organizationHierarchySettingsMarkup();
    var row = holder.lastElementChild;
    list.appendChild(row);
    row.querySelector('[data-action="remove-hierarchy-role"]').onclick = function () {
      row.remove();
      syncOrganizationHierarchy();
    };
    bindHierarchyPhotoInput(row.querySelector(".hierarchy-photo-input"));
  }

  function syncOrganizationHierarchy() {
    // Only sync when the settings rows are actually on screen, otherwise we would wipe saved roles.
    if (!$(".hierarchy-settings-list")) return;
    state.settings.organizationHierarchy = $$("[data-hierarchy-row]").map(function (row) {
      return {
        role: row.querySelector(".hierarchy-role").value.trim(),
        name: row.querySelector(".hierarchy-name").value.trim(),
        reportsTo: row.querySelector(".hierarchy-manager").value.trim(),
        photo: row.dataset.photo || ""
      };
    });
  }

  function resizeHierarchyPhoto(file, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      var image = new Image();
      image.onload = function () {
        var scale = Math.min(1, 240 / Math.max(image.width, image.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = function () { toast("That photo could not be loaded.", true); };
      image.src = reader.result;
    };
    reader.onerror = function () { toast("That photo could not be read.", true); };
    reader.readAsDataURL(file);
  }

  function bindHierarchyPhotoInput(input) {
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var row = input.closest("[data-hierarchy-row]");
      resizeHierarchyPhoto(file, function (photo) {
        row.dataset.photo = photo;
        row.querySelector(".hierarchy-edit-avatar").innerHTML = '<img src="' + esc(photo) + '" alt="">';
      });
    };
  }

  function field(id, label, value, type) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + esc(value) + '"></div>';
  }

  function areaField(id, label, value) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><textarea id="' + id + '">' + esc(value || '') + '</textarea></div>';
  }

  /* ------------------------------------------------------------------ */
  /*  Saving                                                             */
  /* ------------------------------------------------------------------ */

  async function saveSettings() {
    syncOrganizationHierarchy();
    state.settings.companyName = $("#company-name-setting").value.trim() || "Company";
    state.settings.pacraRegistrationNumber = $("#pacra-number-setting").value.trim();
    state.settings.taxYear = Number($("#tax-year-setting").value) || 2026;
    state.settings.rates = {
      PAYE: $("#rate-paye").value.trim() || "Not set",
      NAPSA: $("#rate-napsa").value.trim() || "Not set",
      NHIMA: $("#rate-nhima").value.trim() || "Not set",
      "SDL / SDC": $("#rate-sdl").value.trim() || "Not set",
      WCFCB: $("#rate-wcfcb").value.trim() || "Not set"
    };
    saveLocal();
    if (state.cloud) {
      try {
        await HRPayrollCloud.saveSettings(state.user, settingsForCloud());
        await HRPayrollCloud.saveOrganization(state.user, clean({ name: state.settings.companyName, pacraRegistrationNumber: state.settings.pacraRegistrationNumber }));
      } catch (e) { console.error(e); toast("Settings could not be saved to Firebase: " + ((e && (e.code || e.message)) || "unknown error"), true); return; }
    }
    updateShell();
    toast("Settings saved.");
  }

  function saveSettingsSilently() {
    saveLocal();
    if (state.cloud) {
      return Promise.resolve()
        .then(function () { return HRPayrollCloud.saveSettings(state.user, settingsForCloud()); })
        .catch(function (e) { console.error(e); toast("Changes could not be saved to Firebase: " + ((e && (e.code || e.message)) || "unknown error"), true); });
    }
    return Promise.resolve();
  }

  function departmentModal(existing) {
    var d = existing || {}, backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal"><div class="modal-header"><h2>' + (existing ? 'Edit department' : 'Add department') + '</h2><button class="modal-close" data-close>×</button></div><form id="department-form"><div class="modal-body"><div class="form-grid"><div class="field"><label>Department name</label><input id="dept-name" required value="' + esc(d.name || '') + '" placeholder="e.g. Human Resources"></div><div class="field"><label>Department description</label><input id="dept-description" value="' + esc(d.description || '') + '" placeholder="Purpose of the department"></div></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save department</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector('#department-form').onsubmit = function (ev) {
      ev.preventDefault();
      var name = $('#dept-name').value.trim(); if (!name) return;
      var item = { id: d.id || 'dept-' + Date.now(), name: name, description: $('#dept-description').value.trim() };
      var arr = hrArray('departments'), idx = arr.findIndex(function (x) { return x.id === item.id; });
      if (idx >= 0) arr[idx] = item; else arr.push(item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Department saved.');
    };
  }

  function jobDescriptionModal(existing) {
    var j = existing || {}, departments = asArray(state.settings.departments), backdrop = document.createElement('div');
    var opts = '<option value="">Select department</option>' + departments.map(function (d) { return '<option ' + (d.name === j.department ? 'selected ' : '') + 'value="' + esc(d.name) + '">' + esc(d.name) + '</option>'; }).join('');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal job-modal"><div class="modal-header"><div><p class="eyebrow">JOB DESCRIPTION</p><h2>' + (existing ? 'Edit job description' : 'Create job description') + '</h2></div><button class="modal-close" data-close>×</button></div><form id="job-form"><div class="modal-body"><div class="form-grid">' + field('job-title', 'Job title', j.title || '') + '<div class="field"><label>Department</label><select id="job-department">' + opts + '</select></div>' + field('job-reports', 'Reports to', j.reportsTo || '') + field('job-location', 'Work location', j.location || '') + '</div><div class="form-section"><h3>Role profile</h3><div class="form-grid">' + areaField('job-purpose', 'Job purpose', j.purpose || '') + '<div class="field"><label>Employment type</label><select id="job-type"><option ' + (j.employmentType === 'Full-time' ? 'selected ' : '') + '>Full-time</option><option ' + (j.employmentType === 'Part-time' ? 'selected ' : '') + '>Part-time</option><option ' + (j.employmentType === 'Contract' ? 'selected ' : '') + '>Contract</option><option ' + (j.employmentType === 'Temporary' ? 'selected ' : '') + '>Temporary</option></select></div></div></div><div class="form-section"><h3>Responsibilities & requirements</h3><div class="form-grid">' + areaField('job-responsibilities', 'Key responsibilities', j.responsibilities || '') + areaField('job-qualifications', 'Education & qualifications', j.qualifications || '') + areaField('job-experience', 'Experience', j.experience || '') + areaField('job-skills', 'Technical skills', j.skills || '') + areaField('job-competencies', 'Behavioural competencies', j.competencies || '') + areaField('job-kpis', 'Key performance indicators (KPIs)', j.kpis || '') + '</div></div><div class="form-section"><div class="form-grid">' + field('job-review', 'Review date', j.reviewDate || '', 'date') + field('job-approval', 'Approved by', j.approvedBy || '') + '</div></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save job description</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector('#job-form').onsubmit = function (ev) {
      ev.preventDefault();
      var item = { id: j.id || 'job-' + Date.now(), title: $('#job-title').value.trim(), department: $('#job-department').value, reportsTo: $('#job-reports').value.trim(), location: $('#job-location').value.trim(), purpose: $('#job-purpose').value.trim(), employmentType: $('#job-type').value, responsibilities: $('#job-responsibilities').value.trim(), qualifications: $('#job-qualifications').value.trim(), experience: $('#job-experience').value.trim(), skills: $('#job-skills').value.trim(), competencies: $('#job-competencies').value.trim(), kpis: $('#job-kpis').value.trim(), reviewDate: $('#job-review').value, approvedBy: $('#job-approval').value.trim() };
      if (!item.title) return;
      upsert(hrArray('jobDescriptions'), item);
      saveSettingsSilently(); backdrop.remove(); render(); toast('Job description saved.');
    };
  }

  function employeeModal(existing) {
    var e = existing || {};
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-header"><h2>' + (existing ? "Edit employee" : "Add employee") + '</h2><button class="modal-close" data-close>×</button></div>' +
      '<form id="employee-form"><div class="modal-body"><div class="form-grid">' +
      field("employee-name", "Full name", e.name || "") + field("employee-id", "Employee ID", e.employeeId || "") +
      '<div class="field"><label for="employee-department">Department</label><select id="employee-department"><option value="">Select department</option>' + (asArray(state.settings.departments).map(function (d) { return '<option ' + (d.name === e.department ? 'selected ' : '') + 'value="' + esc(d.name) + '">' + esc(d.name) + '</option>'; }).join('')) + '</select></div>' + field("employee-position", "Position", e.position || "") +
      field("employee-salary", "Monthly basic salary (ZMW)", e.salary || "", "number") + field("employee-housing", "Monthly housing allowance (ZMW)", e.housingAllowance || 0, "number") + field("employee-food", "Monthly food allowance (ZMW)", e.foodAllowance || 0, "number") + field("employee-allowances", "Other monthly taxable allowances (ZMW)", e.allowances || 0, "number") + field("employee-contract", "Contract start date", e.contractStart || "", "date") + field("employee-status", "Status", e.status || "Active") +
      '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save employee</button></div></form></div>';
    wireModal(backdrop);
    backdrop.querySelector("#employee-form").onsubmit = async function (ev) {
      ev.preventDefault();
      var employee = {
        name: $("#employee-name").value.trim(),
        employeeId: $("#employee-id").value.trim(),
        department: $("#employee-department").value.trim(),
        position: $("#employee-position").value.trim(),
        salary: Number($("#employee-salary").value) || 0,
        housingAllowance: Number($("#employee-housing").value) || 0,
        foodAllowance: Number($("#employee-food").value) || 0,
        allowances: Number($("#employee-allowances").value) || 0,
        contractStart: $("#employee-contract").value || "",
        status: $("#employee-status").value.trim() || "Active"
      };
      if (!employee.name) return;
      try {
        if (existing) {
          if (state.cloud) await HRPayrollCloud.updateEmployee(state.user, existing.id, clean(employee));
          Object.assign(existing, employee);
        } else {
          if (state.cloud) {
            var ref = await HRPayrollCloud.addEmployee(state.user, clean(employee));
            employee.id = ref.id;
          } else employee.id = "local-" + Date.now();
          employee.createdAt = new Date().toISOString();
          state.employees.unshift(employee);
        }
        saveLocal();
        backdrop.remove();
        render();
        toast("Employee saved.");
      } catch (err) { console.error(err); toast("Employee could not be saved: " + ((err && (err.code || err.message)) || "unknown error"), true); }
    };
  }

  function openEmployeeCalculator(id) {
    var e = state.employees.find(function (x) { return x.id === id; });
    if (!e) return;
    state.view = "calculator";
    render();
    $("#calc-employee").value = e.id;
    $("#calc-basic").value = e.salary || 0;
    $("#calc-housing").value = e.housingAllowance || 0;
    $("#calc-food").value = e.foodAllowance || 0;
    $("#calc-allowances").value = e.allowances || 0;
    $("#calculator-results").innerHTML = calculatorResults();
    bindPayslipActions();
    toast("Calculator loaded for " + e.name + ".");
  }

  async function deleteEmployee(id) {
    var e = state.employees.find(function (x) { return x.id === id; });
    if (!e || !confirm("Delete " + e.name + "?")) return;
    try {
      if (state.cloud) await HRPayrollCloud.deleteEmployee(state.user, id);
      state.employees = state.employees.filter(function (x) { return x.id !== id; });
      saveLocal();
      render();
      toast("Employee deleted.");
    } catch (err) { console.error(err); toast("Employee could not be deleted: " + ((err && (err.code || err.message)) || "unknown error"), true); }
  }

  async function runPayroll() {
    if (!state.employees.length) { toast("Add at least one employee before recording a payroll run.", true); return; }
    var totals = state.employees.reduce(function (acc, e) {
      var c = calculatePayroll(e.salary || 0, e.allowances || 0, 0, 0, 0, e.housingAllowance || 0, e.foodAllowance || 0);
      acc.gross += c.gross; acc.net += c.net; acc.paye += c.paye; acc.employeeDeductions += c.totalEmployeeDeductions; acc.employerCost += c.employerCost; return acc;
    }, { gross: 0, net: 0, paye: 0, employeeDeductions: 0, employerCost: 0 });
    var now = new Date();
    var period = now.toLocaleString("en-ZM", { month: "long", year: "numeric" });
    var lines = state.employees.map(function (e) {
      var c = calculatePayroll(e.salary || 0, e.allowances || 0, 0, 0, 0, e.housingAllowance || 0, e.foodAllowance || 0);
      return { employeeId: e.id, name: e.name, basic: c.basic, housing: c.housing, food: c.food, allowances: c.allowances, additions: c.additions, gross: c.gross, paye: c.paye, napsa: c.napsaEmployee, nhima: c.nhimaEmployee, otherDeductions: c.otherDeductions, totalDeductions: c.totalDeductions, net: c.net, employerCost: c.employerCost };
    });
    var payroll = { period: period, employeeCount: state.employees.length, gross: totals.gross, net: totals.net, paye: totals.paye, employeeDeductions: totals.employeeDeductions, employerCost: totals.employerCost, lines: lines, status: "Completed" };
    try {
      if (state.cloud) {
        var ref = await HRPayrollCloud.addPayroll(state.user, clean(payroll));
        payroll.id = ref.id;
      } else {
        payroll.id = "local-pay-" + Date.now();
      }
      payroll.createdAt = new Date().toISOString();
      state.payrolls.unshift(payroll);
      saveLocal();
      render();
      toast("Payroll run recorded for " + period + ".");
    } catch (e) { console.error(e); toast("Payroll could not be recorded: " + ((e && (e.code || e.message)) || "unknown error"), true); }
  }

  /* ------------------------------------------------------------------ */
  /*  Payslip                                                            */
  /* ------------------------------------------------------------------ */

  function currentCalculator() {
    var c = calculatePayroll($("#calc-basic").value, $("#calc-allowances").value, $("#calc-overtime").value, $("#calc-bonus").value, $("#calc-other").value, $("#calc-housing").value, $("#calc-food").value);
    var employee = state.employees.find(function (e) { return e.id === $("#calc-employee").value; }) || { name: "Employee", employeeId: "", position: "", department: "" };
    var period = $("#calc-period").value || new Date().toISOString().slice(0, 7);
    var paymentMethod = $("#calc-cheque") && $("#calc-cheque").checked ? "Cheque" : ($("#calc-cash") && $("#calc-cash").checked ? "Cash" : "Not selected");
    var signedBy = $("#calc-signed-by") ? $("#calc-signed-by").value.trim() : "";
    return { c: c, employee: employee, period: period, paymentMethod: paymentMethod, signedBy: signedBy };
  }

  function payslipHtml(data) {
    var c = data.c, e = data.employee, company = state.settings.companyName || "Company", pacra = state.settings.pacraRegistrationNumber || "—";
    var payment = data.paymentMethod || "Not selected";
    var signedBy = data.signedBy || "—";
    var cashTick = payment === "Cash" ? "☑" : "☐";
    var chequeTick = payment === "Cheque" ? "☑" : "☐";
    return '<!doctype html><html><head><meta charset="utf-8"><title>Payslip - ' + esc(e.name) + '</title><style>body{font-family:Arial,sans-serif;margin:0;background:#eef3f8;color:#10233f}.sheet{max-width:800px;margin:30px auto;background:#fff;padding:32px;border:1px solid #d6e0eb}.head{display:flex;justify-content:space-between;border-bottom:3px solid #0b3a70;padding-bottom:16px}.brand{font-size:24px;font-weight:700;color:#0b3a70}.muted{color:#607089;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:20px 0}.section-title{font-weight:700;font-size:14px;color:#0b3a70;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.04em}.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #e4e9ef}.total{font-weight:700;font-size:16px}.sub-total{background:#f6f8fb}.net{background:#eaf2fb;padding:14px;border:1px solid #b9cde3}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;padding:12px;border:1px solid #d6e0eb;background:#fafcfe}.meta div{padding:4px 0}.words{padding:12px;border:1px solid #d6e0eb;margin-top:12px;background:#fff}.sign{display:grid;grid-template-columns:1fr 1fr;gap:35px;margin-top:36px}.line{border-top:1px solid #7b8898;padding-top:7px;color:#49566b;font-size:12px}.foot{margin-top:25px;font-size:12px;color:#607089}@media print{body{background:#fff}.sheet{margin:0;border:0;max-width:none}}</style></head><body><div class="sheet"><div class="head"><div><div class="brand">HR PAYROLL</div><div>' + esc(company) + '</div><div class="muted">PACRA: ' + esc(pacra) + '</div></div><div><strong>PAYSLIP</strong><div class="muted">' + esc(data.period) + '</div></div></div><div class="grid"><div><strong>Employee</strong><br>' + esc(e.name) + '</div><div><strong>Employee ID</strong><br>' + esc(e.employeeId || '—') + '</div><div><strong>Position</strong><br>' + esc(e.position || '—') + '</div><div><strong>Department</strong><br>' + esc(e.department || '—') + '</div></div><div class="section-title">Additions</div><div class="row"><span>Basic salary</span><strong>' + money(c.basic) + '</strong></div><div class="row"><span>Housing allowance</span><strong>' + money(c.housing) + '</strong></div><div class="row"><span>Food allowance</span><strong>' + money(c.food) + '</strong></div><div class="row"><span>Other taxable allowances</span><strong>' + money(c.allowances) + '</strong></div><div class="row"><span>Overtime</span><strong>' + money(c.overtime) + '</strong></div><div class="row"><span>Bonus / commission</span><strong>' + money(c.bonus) + '</strong></div><div class="row total sub-total"><span>Total additions (gross salary)</span><strong>' + money(c.gross) + '</strong></div><div class="section-title">Deductions</div><div class="row"><span>PAYE</span><strong>' + money(c.paye) + '</strong></div><div class="row"><span>NAPSA employee</span><strong>' + money(c.napsaEmployee) + '</strong></div><div class="row"><span>NHIMA employee</span><strong>' + money(c.nhimaEmployee) + '</strong></div><div class="row"><span>Other deductions</span><strong>' + money(c.otherDeductions) + '</strong></div><div class="row total sub-total"><span>Total deductions</span><strong>' + money(c.totalDeductions) + '</strong></div><div class="row net total"><span>NET SALARY</span><strong>' + money(c.net) + '</strong></div><div class="words"><strong>Net salary in words:</strong><br>' + esc(amountInWords(c.net)) + '</div><div class="meta"><div><strong>Payment method</strong><br>' + cashTick + ' Cash &nbsp;&nbsp; ' + chequeTick + ' Cheque</div><div><strong>Signed by</strong><br>' + esc(signedBy) + '</div></div><div class="sign"><div class="line">Employee signature</div><div class="line">Authorised signature</div></div><div class="foot">Employer contributions: NAPSA ' + money(c.napsaEmployer) + ', NHIMA ' + money(c.nhimaEmployer) + ', SDL ' + money(c.sdl) + ', WCFCB ' + money(c.wcfcb) + '. Generated by HR Payroll.</div></div></body></html>';
  }

  function printPayslip() {
    var data = currentCalculator(), w = window.open("", "_blank", "width=900,height=800");
    if (!w) { toast("Allow pop-ups to print the payslip.", true); return; }
    w.document.open(); w.document.write(payslipHtml(data)); w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 250);
  }

  function downloadPayslip() {
    var data = currentCalculator(), blob = new Blob([payslipHtml(data)], { type: "text/html" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "payslip-" + String(data.employee.name || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + data.period + ".html"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500); toast("Payslip downloaded.");
  }

  async function sharePayslip() {
    var data = currentCalculator(), html = payslipHtml(data), file = new File([html], "payslip-" + String(data.employee.name || "employee").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".html", { type: "text/html" });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ title: "Payslip - " + data.employee.name, text: "Payslip for " + data.employee.name + " - " + data.period, files: [file] });
      else if (navigator.share) await navigator.share({ title: "Payslip - " + data.employee.name, text: "Payslip for " + data.employee.name + " - " + data.period + ". Net pay: " + money(data.c.net) });
      else if (navigator.clipboard) { await navigator.clipboard.writeText("Payslip for " + data.employee.name + " - " + data.period + ". Net pay: " + money(data.c.net)); toast("Payslip details copied. You can share them."); }
      else toast("Sharing is not available on this device.", true);
    } catch (e) { if (e.name !== "AbortError") toast("Sharing is not available on this device.", true); }
  }

  function backup() {
    var data = { exportedAt: new Date().toISOString(), settings: state.settings, employees: state.employees, payrolls: state.payrolls, statutoryUpdates: state.statutoryUpdates };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hr-payroll-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  async function saveStatutory() {
    var rules = state.settings.payrollRules;
    state.settings.taxYear = Number($("#stat-year").value) || 2026;
    rules.napsa.ceiling = Number($("#stat-napsa-ceiling").value) || 28920.30;
    rules.napsa.employeeRate = (Number($("#stat-napsa-rate").value) || 5) / 100;
    rules.napsa.employerRate = rules.napsa.employeeRate;
    rules.nhima.employeeRate = (Number($("#stat-nhima-rate").value) || 1) / 100;
    rules.nhima.employerRate = rules.nhima.employeeRate;
    rules.sdl.employerRate = (Number($("#stat-sdl-rate").value) || .5) / 100;
    rules.wcfcb.employerRate = (Number($("#stat-wcf-rate").value) || 0) / 100;
    state.settings.agencyRecords = { PACRA: $("#rec-pacra").value.trim(), ZDA: $("#rec-zda").value.trim(), ZEMA: $("#rec-zema").value.trim(), ZRA: $("#rec-zra").value.trim(), NAPSA: $("#rec-napsa").value.trim(), NHIMA: $("#rec-nhima").value.trim(), WCFCB: $("#rec-wcfcb").value.trim() };
    saveLocal();
    if (state.cloud) { try { await HRPayrollCloud.saveSettings(state.user, settingsForCloud()); } catch (e) { console.error(e); toast("Statutory settings could not be saved: " + ((e && (e.code || e.message)) || "unknown error"), true); return; } }
    updateShell(); render(); toast("Statutory settings saved.");
  }

  async function addStatutoryUpdate() {
    var agency = $("#update-agency").value.trim(), note = $("#update-note").value.trim(), effective = $("#update-effective").value, source = $("#update-source").value.trim();
    if (!agency || !note) { toast("Enter an agency and update note.", true); return; }
    var item = { agency: agency, update: note, effective: effective, source: source, recordedAt: new Date().toISOString() };
    if (state.cloud) { try { await HRPayrollCloud.addStatutoryUpdate(state.user, clean(item)); } catch (e) { console.error(e); toast("Update could not be saved to Firebase: " + ((e && (e.code || e.message)) || "unknown error"), true); return; } }
    state.statutoryUpdates.unshift(item);
    saveLocal();
    render(); toast("Statutory update recorded.");
  }

  function bindPayslipActions() {
    var p = $("[data-action=\"print-payslip\"]"); if (p) p.onclick = printPayslip;
    var d = $("[data-action=\"download-payslip\"]"); if (d) d.onclick = downloadPayslip;
    var sh = $("[data-action=\"share-payslip\"]"); if (sh) sh.onclick = sharePayslip;
  }

  function removeFromSettings(key, id, message) {
    state.settings[key] = asArray(state.settings[key]).filter(function (x) { return x.id !== id; });
    saveSettingsSilently(); render(); toast(message);
  }

  function findIn(key, id) { return asArray(state.settings[key]).find(function (x) { return x.id === id; }); }

  function bindView() {
    $$("[data-view]").forEach(function (el) {
      el.onclick = function () {
        state.view = el.getAttribute("data-view");
        $$(".nav-link").forEach(function (n) { n.classList.toggle("is-active", n.getAttribute("data-view") === state.view); });
        $("#page-crumb").textContent = state.view.charAt(0).toUpperCase() + state.view.slice(1);
        render();
      };
    });
    $$("[data-action]").forEach(function (el) {
      el.onclick = function () {
        var action = el.getAttribute("data-action"), id = el.dataset.id;
        if (action === "add-employee") employeeModal();
        if (action === "edit-employee") employeeModal(state.employees.find(function (e) { return e.id === id; }));
        if (action === "delete-employee") deleteEmployee(id);
        if (action === "calculate-employee") openEmployeeCalculator(id);
        if (action === "run-payroll") runPayroll();
        if (action === "print-payslip") printPayslip();
        if (action === "download-payslip") downloadPayslip();
        if (action === "share-payslip") sharePayslip();
        if (action === "save-settings") saveSettings();
        if (action === "add-hierarchy-role") addHierarchyRole();
        if (action === "remove-hierarchy-role") { el.closest("[data-hierarchy-row]").remove(); syncOrganizationHierarchy(); }
        if (action === "backup") backup();
        if (action === "open-settings") { state.view = "settings"; render(); }
        if (action === "review-compliance") complianceModal(el.dataset.key);
        if (action === "add-department") departmentModal();
        if (action === "edit-department") departmentModal(findIn("departments", id));
        if (action === "delete-department") removeFromSettings("departments", id, "Department removed.");
        if (action === "add-job") jobDescriptionModal();
        if (action === "edit-job") jobDescriptionModal(findIn("jobDescriptions", id));
        if (action === "delete-job") removeFromSettings("jobDescriptions", id, "Job description removed.");
        if (action === "add-leave") leaveModal();
        if (action === "edit-leave") leaveModal(findIn("leaveRecords", id));
        if (action === "delete-leave") removeFromSettings("leaveRecords", id, "Leave record removed.");
        if (action === "add-objective") objectiveModal();
        if (action === "edit-objective") objectiveModal(findIn("performanceObjectives", id));
        if (action === "delete-objective") removeFromSettings("performanceObjectives", id, "Objective removed.");
        if (action === "add-review") reviewModal();
        if (action === "edit-review") reviewModal(findIn("performanceReviews", id));
        if (action === "delete-review") removeFromSettings("performanceReviews", id, "Performance review removed.");
        if (action === "add-training") trainingModal();
        if (action === "edit-training") trainingModal(findIn("trainingPrograms", id));
        if (action === "delete-training") removeFromSettings("trainingPrograms", id, "Training programme removed.");
        if (action === "close-compliance") { var cm = $("#compliance-modal"); if (cm) cm.remove(); }
      };
    });
    $$(".hierarchy-photo-input").forEach(function (input) {
      bindHierarchyPhotoInput(input);
    });
    if (state.view === "calculator") {
      ["#calc-basic", "#calc-housing", "#calc-food", "#calc-allowances", "#calc-overtime", "#calc-bonus", "#calc-other", "#calc-signed-by"].forEach(function (id) {
        var el = $(id);
        if (el) el.oninput = function () {
          $("#calculator-results").innerHTML = calculatorResults();
          bindPayslipActions();
        };
      });
      var cash = $("#calc-cash"), cheque = $("#calc-cheque");
      if (cash) cash.onchange = function () { if (cash.checked && cheque) cheque.checked = false; $("#calculator-results").innerHTML = calculatorResults(); bindPayslipActions(); };
      if (cheque) cheque.onchange = function () { if (cheque.checked && cash) cash.checked = false; $("#calculator-results").innerHTML = calculatorResults(); bindPayslipActions(); };
      var employeeSelect = $("#calc-employee");
      if (employeeSelect) employeeSelect.onchange = function () {
        var e = state.employees.find(function (x) { return x.id === employeeSelect.value; });
        if (e) {
          $("#calc-basic").value = e.salary || 0;
          $("#calc-housing").value = e.housingAllowance || 0;
          $("#calc-food").value = e.foodAllowance || 0;
          $("#calc-allowances").value = e.allowances || 0;
        }
        $("#calculator-results").innerHTML = calculatorResults();
        bindPayslipActions();
      };
      $("#calculator-results").innerHTML = calculatorResults();
      bindPayslipActions();
    }
    var openCalc = $$('[data-action="open-calculator"]');
    openCalc.forEach(function (el) { el.onclick = function () { state.view = "calculator"; render(); }; });
    $$('[data-action="save-statutory"]').forEach(function (el) { el.onclick = saveStatutory; });
    $$('[data-action="add-statutory-update"]').forEach(function (el) { el.onclick = addStatutoryUpdate; });
    var globalSearch = $("#workspace-search");
    if (globalSearch) globalSearch.oninput = function () {
      var q = globalSearch.value.toLowerCase().trim();
      $$(".nav-link[data-view]").forEach(function (n) { n.style.display = !q || n.textContent.toLowerCase().indexOf(q) !== -1 ? "flex" : "none"; });
      $$(".sidebar-agency").forEach(function (a) { a.style.display = !q || a.textContent.toLowerCase().indexOf(q) !== -1 ? "grid" : "none"; });
    };
    var mobileMenu = $("#mobile-menu-button");
    var sidebarOverlay = $("#sidebar-overlay");
    function closeMobileSidebar() {
      document.body.classList.remove("sidebar-open");
      if (mobileMenu) mobileMenu.setAttribute("aria-expanded", "false");
      if (sidebarOverlay) sidebarOverlay.setAttribute("aria-hidden", "true");
    }
    function openMobileSidebar() {
      document.body.classList.add("sidebar-open");
      if (mobileMenu) mobileMenu.setAttribute("aria-expanded", "true");
      if (sidebarOverlay) sidebarOverlay.setAttribute("aria-hidden", "false");
    }
    if (mobileMenu) mobileMenu.onclick = function () { document.body.classList.contains("sidebar-open") ? closeMobileSidebar() : openMobileSidebar(); };
    if (sidebarOverlay) sidebarOverlay.onclick = closeMobileSidebar;
    $$(".nav-link[data-view]").forEach(function (n) { n.addEventListener("click", closeMobileSidebar); });
    var search = $("#employee-search");
    if (search) search.oninput = function () {
      var q = search.value.toLowerCase();
      $("#people-table").innerHTML = employeeTable(state.employees.filter(function (e) {
        return [e.name, e.employeeId, e.department, e.position].join(" ").toLowerCase().indexOf(q) !== -1;
      }));
      bindView();
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Normalisation of loaded data                                       */
  /* ------------------------------------------------------------------ */

  function ensureRules() {
    var s = state.settings;
    if (typeof s.companyName !== "string") s.companyName = "";
    if (typeof s.pacraRegistrationNumber !== "string") s.pacraRegistrationNumber = "";
    if (!s.taxYear) s.taxYear = 2026;
    if (!s.rates || typeof s.rates !== "object") s.rates = defaultSettings().rates;
    if (!s.agencyRecords || typeof s.agencyRecords !== "object") s.agencyRecords = {};
    HR_KEYS.forEach(function (k) { s[k] = asArray(s[k]); });
    s.leaveRecords.forEach(function (r) {
      if (!r.entitlementText) { var c = leaveCatalog().find(function (x) { return x.id === r.leaveType; }); if (c) r.entitlementText = c.entitlement; }
    });

    // Deep-merge each rule block so a partially saved document can never remove napsa/nhima/sdl/wcfcb.
    var def = defaultPayrollRules(), saved = s.payrollRules || {};
    s.payrollRules = {
      paye: Object.assign({}, def.paye, saved.paye || {}),
      napsa: Object.assign({}, def.napsa, saved.napsa || {}),
      nhima: Object.assign({}, def.nhima, saved.nhima || {}),
      sdl: Object.assign({}, def.sdl, saved.sdl || {}),
      wcfcb: Object.assign({}, def.wcfcb, saved.wcfcb || {})
    };
    s.payrollRules.paye.bands = normalizePayeBands(s.payrollRules.paye.bands);

    // Agencies are a fixed reference list and are never read from the database.
    s.agencies = defaultAgencies();
  }

  /* ------------------------------------------------------------------ */
  /*  Start-up                                                           */
  /* ------------------------------------------------------------------ */

  function init() {
    ensureRules();
    if (window.HRPayrollCloud && HRPayrollCloud.init()) {
      state.cloud = true;
      showAuth("signin");
      HRPayrollCloud.auth.onAuthStateChanged(onUser);
    } else {
      state.cloud = false;
      showAuth("signin");
      setAuthMessage("Firebase could not start. " + ((window.HRPayrollCloud && HRPayrollCloud.lastError) || "The Firebase scripts did not load; check that firebase-cloud.js and firebase-config.js are deployed.") + " Refresh with Ctrl+F5 after deploying.", true);
    }

    $("#sign-out-button").onclick = async function () {
      if (state.cloud && HRPayrollCloud.auth.currentUser) await HRPayrollCloud.auth.signOut();
      else {
        state.user = null;
        resetWorkspace();
        document.body.classList.add("auth-required");
        showAuth("signin");
      }
    };
    $("#backup-button").onclick = backup;
  }

  window.addEventListener("DOMContentLoaded", init);
})();