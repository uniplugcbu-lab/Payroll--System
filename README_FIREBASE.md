# Firebase setup

This app uses Firebase Authentication (email/password) and Cloud Firestore. Each owner account gets an organization whose document ID is the Firebase Auth UID. Firestore rules restrict workspace data to authenticated members of that organization.

## Configure

1. Create a Firebase project and register a Web App.
2. Enable **Authentication → Email/Password** and create a **Cloud Firestore** database.
3. Copy the Web App configuration into `firebase-config.js`. These browser values are not admin credentials; never put a service-account key in this app.
4. Add the deployed Firebase Hosting domain under **Authentication → Settings → Authorized domains**.
5. Install the Firebase CLI, select the project with `firebase use --add`, then deploy the rules and site:

   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,hosting
   ```

For a local UI preview on the PC, run `.\serve.ps1` and open `http://localhost:8765/`. The preview does not connect to Firebase until `firebase-config.js` is configured. Use the HTTPS Firebase Hosting URL for real sign-in and Android access; opening `index.html` as a `file://` URL cannot provide a secure Firebase Auth origin.

If this browser already has a non-demo local workspace, company sign-up offers an explicit checkbox to import its employees, payroll history, settings and uploaded logos into the new company. Nothing is uploaded unless that box is selected. Company invitations and additional member accounts are not available yet; the initial Firebase version creates one owner account per company.

## Data layout

- `organizations/{ownerUid}` stores the organization profile and owner UID.
- `organizations/{ownerUid}/members/{uid}` stores organization membership and role.
- `organizations/{ownerUid}/data/settings` stores company and statutory settings.
- `organizations/{ownerUid}/employees/{employeeId}` stores employee records.
- `organizations/{ownerUid}/payrolls/{payrollId}` stores payroll runs.
- `organizations/{ownerUid}/logos/{logoKey}` stores uploaded logo data separately from workspace documents.

The client can create the initial organization only at its own UID. Additional employee/member invitations are not implemented yet; do not weaken the Firestore rules to make arbitrary organization IDs writable.


## Payroll and compliance additions

The application now includes:

- Zambia 2026 PAYE calculator using ZRA bands of 0%, 20%, 30% and 37%.
- NAPSA employee/employer contribution calculation with the configured 2026 ceiling of K28,920.30 earnings / K2,892.03 combined maximum contribution.
- NHIMA employee and employer calculation at 1% each of basic salary.
- Skills Development Levy at 0.5% of chargeable gross emoluments, employer borne.
- Configurable WCFCB assessment rate because the employer assessment is industry/risk based.
- Statutory centre for ZRA, NAPSA, NHIMA, WCFCB, PACRA, ZDA and ZEMA.
- Company-specific PACRA, ZDA, ZEMA and other registration/compliance records stored in Firestore settings.
- Statutory update log with agency, effective date, note and official source URL.
- HR/employer compliance dashboard covering contracts, payslips, policies, working hours, leave/maternity, labour statistics, wages and statutory registrations.
- Responsive desktop and mobile layouts.

### Important data-source limitation

The statutory centre does not pretend to have direct access to the internal databases of ZRA, NAPSA, NHIMA, PACRA, ZDA, ZEMA or WCFCB. The app stores company records and official source references in Firestore. Automatic ingestion of future agency changes requires an official API/feed or an authorised integration. Until such an integration exists, an HR/admin user can record an official update in the Statutory Centre and apply the new effective rule to the calculator.

### Current official references used for the initial rules

- ZRA Tax Information: https://www.zra.org.zm/tax-information/
- NAPSA Formal Sector Contributions: https://www.napsa.co.zm/self-service/formal-sector
- NHIMA FAQs: https://nhima.co.zm/elementor-1783/
- ZRA Skills Development Levy guidance: https://www.zra.org.zm/wp-content/uploads/2025/08/Skills-Development-Levy-2025.pdf
- Ministry of Labour Employment Code: https://www.mlss.gov.zm/wp-content/uploads/2023/07/The-Employment-Code-Act-No.-3-of-2019.pdf
- PACRA: https://www.pacra.org.zm/
- ZDA: https://zda.org.zm/
- ZEMA: https://www.zema.org.zm/
- WCFCB: https://www.workers.com.zm/
