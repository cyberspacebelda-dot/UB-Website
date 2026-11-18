# Firebase Authentication Migration — Android + Website

## Approved scope and safety boundary

This migration covers all Android application roles and the connected website. Work is isolated to branch `hm-google-email-auth-v1` in `cyberspacebelda-dot/UB-Website` plus a separate Android working branch when its source repository is confirmed.

- Do not change Production Firestore Rules, live Firestore data, Firebase Authentication users, or production hosting during planning and implementation.
- Do not merge to `main`, publish, or deploy without separate explicit approval.
- Do not grant a role from a client-side dropdown, name substring, editable profile field, or unverified email.
- Do not start Firestore listeners until Firebase Authentication and server-controlled role resolution complete.
- Do not fall back to the default Firestore database. Use only the verified named database after project/database identity is reconciled.

## Approved role mapping

| Person / user group | Role key | Identity / provisioning status |
|---|---|---|
| Super Admin | `SUPER_ADMIN` | Temporary designated email: `cyberspacebelda@gmail.com`; may be changed later through a privileged, audited process |
| Staff Gopal | `STAFF_GOPAL` | Exact Google email still required |
| Staff Milan | `STAFF_MILAN` | Exact Google email still required |
| Staff Sonali | `STAFF_SONALI` | `sonalidas747774@gmail.com` |
| Staff Koushik | `STAFF_KOUSHIK` | `koushikghosh585@gmail.com` |
| Staff Jeet | `STAFF_JEET` | `swagatahazra2005@gmail.com` |
| Approved Health Mitra | `VERIFIED_HM` | Assigned only after trusted approval and UID-to-HM mapping |
| Pending Health Mitra | `PENDING_HM` | No operational-data access |
| Public customer | `PUBLIC_CUSTOMER` | No medicines access under the owner's explicit access policy |

There are no `ADMIN_2` or `ADMIN_3` roles. Gopal and Milan are Staff, not Admins. The only designated Super Admin at this stage is the email above. Email is an enrollment hint, not sufficient authorization by itself: provision the role against a verified Firebase Auth UID using a trusted Admin SDK process/custom claims or an equivalently protected server-side allowlist.

## Access policy

- Medicines: readable only by approved Staff and Super Admin. Not readable by unauthenticated users, Pending HM, Approved HM, or Public Customer.
- Staff access: grant only the specific operational permissions required by each staff workflow; Staff Gopal and Staff Milan do not inherit Super Admin privileges.
- HM: UID must map to one approved HM profile. Pending/rejected HM accounts cannot read medicines, other HM profiles, bills, returns, ledger, or operational configuration.
- Public customers: no access to internal stock, HM, billing, commission, or staff collections unless a separately reviewed customer feature explicitly requires a narrowly scoped endpoint.
- Super Admin-only operations (staff provisioning, HM approval, rank changes, commission/payout configuration, sensitive exports) must be enforced server-side and audited.

## Identity and data model

1. Firebase Authentication establishes the signed-in UID (Google Sign-In for Staff/Super Admin; Firebase Email/Password or another explicitly selected provider for HM).
2. Trusted provisioning assigns role claims or writes a protected UID-keyed role record such as `office_staff_auth/{uid}`. Clients cannot write or edit this record.
3. HM identities use a stable Auth UID mapping to the approved HM record. Never scan/download the full `health_mitras` collection to authenticate an HM.
4. HM code lookup, if retained, must use a rate-limited trusted backend endpoint and must not disclose whether arbitrary codes exist.
5. Remove plaintext HM passwords from Firestore and all client-side password comparison/default-password paths.
6. Registration requests are UID-keyed and contain applicant-supplied profile fields only. Status, HM code, rank, role, and approval are server-controlled.
7. The role schema must be reconciled with the Android model and precompiled JAR before integration. No client may self-assign a role or privilege.

## Implementation sequence

### Phase 1 — inventory and reconciliation
- Confirm Android source repository/branch and enumerate all login screens, role checks, repositories, listeners, and privileged writes.
- Reconcile Firebase project identity using the uploaded Android `google-services.json` and the Web SDK config supplied by the owner on 2026-11-18. Both identify project ID `ub-ayurved` and project number / messaging sender ID `893264713046`; the Android app ID is `1:893264713046:android:8964bf3f130a0b90cff2f7` for package `com.aistudio.ubayurved.plkrtw`, and the Web app ID is `1:893264713046:web:1bc7da53d88c7c0bcff2f7`. The earlier audit value `297378462371` conflicts with the actual uploaded config and must be treated as a stale/incorrect audit value unless a newer authoritative Android config proves otherwise.
- The Android and Web API keys are different, which is expected for separately registered Firebase apps; do not replace one with the other. Confirm the Android signing certificate SHA-1 (`e3235ed38944f456b6c9c895d3b5da0c000cc802`) against the signing key used for the distributed APK before relying on Google Sign-In. The Web config's `authDomain` is `ub-ayurved.firebaseapp.com`.
- The owner confirmed in Firebase Console that the named Firestore database ID is `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2` and its actual Firestore region is `asia-east1`. The region is not required to match the Realtime Database region. Both clients must explicitly select this exact named database; neither may silently fall back to `(default)`. The Website now selects this named database directly.
- Obtain exact Google emails for Staff Gopal and Staff Milan. Keep these roles unprovisioned until confirmed.
- Identify whether Public Customer requires a login provider; do not invent one before confirming app behavior.

### Phase 2 — trusted role provisioning
- Implement a protected Admin SDK / Cloud Functions provisioning path or documented one-time secure operator process.
- Bind the Super Admin to the verified UID for `cyberspacebelda@gmail.com`.
- Bind each Staff role to its verified UID after first successful sign-in and identity confirmation.
- Ensure only Super Admin can provision/revoke staff roles and approve HM accounts.
- Record actor, target UID, old role, new role, timestamp, and reason for every privileged role change.

### Phase 3 — Android authentication migration
- Add Firebase Auth sign-in and sign-out for all approved roles.
- Resolve role from trusted claims/records after sign-in; never infer from display name, email substring, or local preferences.
- Gate app navigation, Firestore reads, listeners, and writes on resolved role.
- Start only role-authorized listeners; cancel them on sign-out or role change.
- Update source/JAR integration without unsafe duplicate classes or fallback repositories.
- Ensure HM UID-to-profile mapping and remove plaintext password logic.

### Phase 4 — website authentication migration
- Replace HM code/password comparison and direct public HM profile writes.
- Integrate website sign-in with the same Firebase project, Auth tenant/configuration, and named Firestore database as Android.
- Remove startup-wide listeners; initialize each listener only after role resolution and only for authorized data.
- Keep Office UI behavior separate from actual authorization; retire client-side PINs as a security boundary.

### Phase 5 — rules, backend, and tests
- Author replacement Firestore Rules only after all collection and subcollection paths, fields, and workflows are inventoried.
- Enforce medicines read access only for `SUPER_ADMIN` and approved Staff roles.
- Enforce HM ownership and approval state; deny unauthenticated, Pending HM, Approved HM, and Public Customer reads of medicines.
- Move sensitive writes to trusted backend operations where practical; validate fields, ownership, state transitions, and idempotency.
- Run Firebase Emulator tests for unauthenticated, each Staff role, Super Admin, Pending HM, Approved HM, and Public Customer. Include cross-role and direct REST/SDK access tests.
- Test sign-out listener cleanup, token refresh/claim changes, account disable/revocation, and database selection.

### Phase 6 — controlled release
- Require a passing security review and regression checklist.
- Deploy rules/backend and app/web changes in a coordinated, reversible sequence only after explicit approval.
- Monitor denied requests, auth failures, and unexpected listener activity.
- Keep a rollback plan that does not re-enable public reads or plaintext HM passwords.

## Known blockers / not yet verified

- Staff Gopal and Staff Milan exact Google email addresses are not supplied.
- Firebase project identity is reconciled from the actual uploaded Android config and owner-supplied Web config: both point to `ub-ayurved` / `893264713046`. The earlier audit's `297378462371` is inconsistent and should not be used as the Android config source of truth.
- Firebase Authentication provider enablement (Google and Email/Password), authorized domains, Web OAuth client linkage, and Android signing-certificate SHA-1 have not yet been independently verified in Firebase Console.
- The Web and Android Firebase API keys are distinct app-specific keys; verify their API restrictions and allowed APIs rather than forcing them to match.
- The complete Android source/JAR compatibility path and exact role-specific permissions still need code-level inspection.
- The deployed Firestore Rules and all nested collection/subcollection schemas need authoritative export and emulator coverage.
- A trusted backend approval/provisioning endpoint is not yet present in the inspected website repository.
- Public Customer sign-in requirements are not yet confirmed.

## Current checkpoint

This document records the approved role naming and migration scope. It does not create Firebase Auth users, assign claims, modify Firestore, change Production Rules, merge branches, or deploy anything.


## Firebase project configuration reconciliation — 2026-11-18

Owner supplied the Web SDK config and uploaded the Android `google-services.json`. Both configs agree on:
- Project ID: `ub-ayurved`
- Project number / messaging sender ID: `893264713046`
- Storage bucket: `ub-ayurved.firebasestorage.app`
- Realtime Database URL: `https://ub-ayurved-default-rtdb.asia-southeast1.firebasedatabase.app`
- Android package: `com.aistudio.ubayurved.plkrtw`
- Android app ID: `1:893264713046:android:8964bf3f130a0b90cff2f7`
- Web app ID: `1:893264713046:web:1bc7da53d88c7c0bcff2f7`
- Web auth domain: `ub-ayurved.firebaseapp.com`

The Android OAuth client entries include an Android client associated with certificate SHA-1 `e3235ed38944f456b6c9c895d3b5da0c000cc802` and a Web-type OAuth client. Confirm the SHA-1 against the actual release/debug signing certificate before Google Sign-In testing. Different Android and Web Firebase API keys are expected for separate app registrations.

The prior audit's Android project number `297378462371` does not match the uploaded Android config. For this checkpoint, the actual uploaded `google-services.json` is the configuration evidence and `893264713046` is the reconciled project number. If a different Android config is later supplied from the current build, re-check before implementation.

Owner-confirmed in Firebase Console on 2026-11-18: Google and Email/Password providers are enabled; the website domain is authorized; Android release signing SHA-1 was checked by the owner; the named Firestore database exists with ID `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2` in region `asia-east1`. These are owner-reported checks, not independently inspected Console state.

No Auth users, claims, Firestore data, Rules, deployment, or production settings were changed.
