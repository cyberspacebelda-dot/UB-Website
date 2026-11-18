# HM Google / Email Authentication Migration (v1)

## Scope
This work is isolated to branch `hm-google-email-auth-v1`. Do not merge or deploy until the security review and test checklist pass.

- Replace only the Health Mitra (HM) portal's HM Code / mobile + password login.
- Add Google Sign-In and Email / Password authentication for HM users.
- Keep the existing Office / Admin login UI and behavior unchanged in this migration.
- Do not link newly registered identities to legacy HM codes automatically.
- Do not delete or rewrite Android application data as part of this website migration.

## Confirmed findings from the current branch
- The website entry point is `index.html`; it loads `./app.js` as an ES module.
- `app.js` initializes Firestore for database ID `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2`.
- `app.js` currently imports Firestore but not Firebase Authentication.
- HM login currently matches HM code / mobile number against the downloaded `health_mitras` collection and compares a password stored in the document (with a hard-coded default fallback). This must be removed.
- The app currently starts Firestore listeners immediately at module startup, including listeners for `health_mitras`, `bills`, and `medicines`. These listeners must be gated by authenticated role and authorization before any HM data is read.
- HM registration currently lets the browser submit an HM code, rank, password, and `isVerified` fields directly to `health_mitras`. This is not suitable for public self-registration.
- Office login is currently a client-side role/PIN check. This migration must not silently change that flow, but the existing approach is not a secure server-verified identity boundary and requires a separate future hardening review.
- The current repository does not contain `firebase.json`, `.firebaserc`, or `firestore.rules` at its root. The deployment workflow at `.github/workflows/deploy.yml` publishes the repository root to GitHub Pages only on pushes to `main` (or manual dispatch). This branch is not configured to auto-deploy.

## Target HM registration model
1. HM creates or signs into a Firebase Auth account using Google or Email / Password.
2. Email / Password registrations must verify the email before submitting a registration request. Google sign-in must have a verified email.
3. The client submits a UID-keyed request to `hm_registration_requests/{uid}`, containing only applicant-provided profile fields (name, mobile, address, sponsor reference) and server-controlled status initialized to `PENDING`.
4. The client cannot choose an HM code, rank, approval status, role, or privilege.
5. Pending / rejected applicants cannot read HM profiles, bills, ledger, medicines, pricing configuration, or other operational data.
6. A trusted Super Admin approval path assigns the HM code and rank and creates the approved HM profile. Approval must not be implemented as an unrestricted client write.
7. Approved HM data access is limited to the approved identity and explicitly authorized records.

## Security and implementation blockers
- The authoritative deployed Firestore Rules are not present in this repository root. Do not replace or deploy rules based on a partial or malformed copy from another branch.
- No trusted backend / Cloud Functions source or verified Super Admin custom-claims provisioning mechanism is present in the inspected root files. A secure approval mechanism must be identified before enabling approval writes.
- The Android Firestore schema and every collection/subcollection used for HM, bills, returns, ledger, medicines, and configuration must be audited before authoring replacement rules.
- The current client-side Office PIN values are embedded in `app.js`. Preserve the Office UI for now, but do not treat this as secure authentication or use its client state as proof of Super Admin authority.

## Required release gates
- Obtain and review the actual deployed rules and Firebase project configuration.
- Implement Auth UI and UID-based pending request flow on this branch only.
- Implement trusted Super Admin approval (server-side / privileged backend).
- Gate Firestore listeners and every data operation by role and approval state.
- Remove HM password storage and all legacy HM password comparison paths.
- Run JavaScript lint / syntax checks and Firebase Emulator tests for anonymous, pending, rejected, approved HM, staff, admin, and Super Admin roles.
- Confirm Office/Admin behavior is unchanged.
- Confirm the GitHub Pages workflow still deploys only from `main`.
- Do not merge to `main` or deploy until all gates pass.

## Branch implementation checkpoint — isolated HM Auth preview

A separate preview has been added at `hm-auth-preview.html` with its module `hm-auth-preview.js`.

- Uses Firebase Google Sign-In and Email/Password sign-in.
- Email/password registration sends an email verification link; unverified users cannot submit a request.
- Creates only `hm_registration_requests/{uid}` with applicant profile fields and initial `PENDING` status.
- Applicant input cannot set HM code, rank, role, approval, password fields in Firestore, or business data.
- The preview reads no `health_mitras`, `medicines`, `bills`, `returns`, `ledger`, or `commission_config` data.
- It is deliberately isolated and is not wired into the existing portal yet.

### Mandatory blockers before integration
1. The authoritative deployed Firestore Rules are not in this repository. The request write must be explicitly constrained to the authenticated UID, verified email, allowed applicant fields, and immutable pending status. Do not assume the preview's write is permitted or secure until emulator tests prove it.
2. No trusted backend / Admin SDK approval endpoint or custom-claims provisioning process exists in the repository.
3. The existing main portal still contains the legacy HM password flow and startup-wide listeners. This preview does not make the existing portal production-safe.
4. Office roles are still PINs embedded in client JavaScript and cannot safely be used as Firestore authorization.
5. Android source/JAR compatibility, deployed Rules, and the Firebase project-number discrepancy still require reconciliation.

No Production Rules, live data, Auth users, main branch, or deployment were changed.
