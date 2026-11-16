# UB-Website Security & Firebase Sync Audit

**Audit date:** 2026-11-16  
**Repository:** cyberspacebelda-dot/UB-Website  
**Audited branch:** firebase-sync-setup (created from main)  
**Scope:** Static source review only. No Firebase project, Authentication users, Firestore data, Firestore Rules, or main-branch changes were made.

## Executive summary

The website already initializes Firebase project `ub-ayurved` and requests the named Firestore database `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2`. It subscribes to shared collections/documents including `health_mitras`, `bills`, `medicines`, `commission_config/medicine_price_list_2026`, `commission_config/incentive_rules_v2`, and `ledger`.

The current implementation is not safe to treat as authenticated or production-secure. Client-side checks are not an authorization boundary.

## Findings

### Critical: office PINs embedded in public client code

`app.js` contains hard-coded office PIN values in the `OFFICE_ROLES` object. The repository is public, so anyone can inspect the current source. Removing values from a new commit does not remove them from Git history or invalidate already exposed PINs.

**Required remediation:** rotate/revoke every exposed office PIN through an approved process; review repository history and distribution; move authentication to Firebase Authentication or a trusted server-side identity provider. Never rely on a PIN embedded in browser JavaScript.

### Critical: HM passwords stored and read as plaintext

The website reads `password` from `health_mitras` documents and compares it in browser code. HM registration/update writes that password to Firestore. This exposes credentials to any client that can read those documents and is not a secure password authentication design.

**Required remediation:** migrate HM sign-in to Firebase Authentication (or another trusted identity service), store only identity/profile metadata in Firestore, and plan credential migration/reset. This requires an approved account migration plan; do not silently change existing users.

### Critical: Firestore listeners start before sign-in

`initFirestoreListeners()` is invoked at module startup, before the login flow. It subscribes to sensitive collections and configuration documents without first establishing an authenticated session. The actual success/failure is controlled by deployed Firestore Rules, which were not inspected or changed in this source-only audit.

**Required remediation:** establish Firebase Auth state first, then attach only the listeners permitted for the authenticated role; unsubscribe on sign-out and role/session changes. Enforce the same access policy in Firestore Rules or a trusted backend.

### High: browser-side role checks are not enforceable security

Properties such as `isSuperAdmin`, `canEditMedAndHm`, `canVerifyBilling`, and `canConfirmDelivery` are maintained in client JavaScript/localStorage. Browser-side checks can be bypassed. Firestore writes use the browser SDK directly.

**Required remediation:** enforce role-based authorization in Firestore Rules using trusted claims/profile documents, or move privileged writes to a trusted backend. UI checks should remain only as a usability layer.

### High: persistent local session is trusted on restore

The website restores `ub_web_session` from localStorage and enters the dashboard based on the stored object. LocalStorage is user-editable and must never establish identity or permissions.

**Required remediation:** restore sessions from Firebase Authentication state and fetch/validate the user's role profile from a trusted source.

### Sync architecture observations

- The web app and Android configuration shown in the project use the same Firebase project ID and named Firestore database ID.
- The website reads the shared medicine catalog from the bundled `price-list-2026.js`, then merges Firestore medicine documents and the `commission_config/medicine_price_list_2026` override document.
- The website writes price overrides to `commission_config/medicine_price_list_2026` and also writes stock/medicine fields to `medicines/{id}`.
- The website reads bills, HM profiles, ledger, and incentive settings using live Firestore listeners.
- This source review alone does not prove that Android uses identical field names, write semantics, or calculations for every collection. A schema-by-schema comparison with the Android source and controlled test environment is required before claiming complete two-way synchronization.
- A fallback from the named Firestore database to the default database is present if initialization throws. This can cause the app to connect to a different database unexpectedly; remove the fallback only after confirming deployment configuration and intended database behavior.

## Safe next steps (approval required where noted)

1. Keep production data and Firestore Rules unchanged during this audit.
2. Rotate exposed office PINs and review Git history; this is an operational credential action and should be explicitly approved.
3. Agree on Firebase Authentication identity mapping for office staff and HM users before replacing login.
4. Review the deployed Firestore Rules and collection access matrix. No rules changes should be applied without explicit approval.
5. Compare Android and web schemas for medicines, stock, bills, HM profiles, ledger, and incentive settings.
6. Test reads/writes against a separate Firebase test project or emulator before production rollout.
7. Only after the security design is approved, implement and validate the web changes on this branch.

## Change log

- Created branch `firebase-sync-setup` from `main`.
- Added this audit report only.
- No application source files changed.
- No Firebase data, Authentication users, or Firestore Rules changed.
- No commits were made to `main`.
