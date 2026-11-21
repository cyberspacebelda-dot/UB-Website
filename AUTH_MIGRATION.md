# UB Ayurved Authentication Migration

## Current status
This branch contains a server-side callable login prototype. It is not deployed and is not yet wired into the website or Android app. Existing Firestore Rules must remain unchanged until all clients have migrated and access paths have been audited.

## Login account contract
Create one document in `login_accounts/{NORMALIZED_LOGIN_ID}` for each account. Never store a PIN or password in this collection.

Required fields:
- `uid`: stable Firebase Auth UID (string)
- `role`: one of the allowlisted role codes in `functions/index.js`
- `accountType`: `OFFICE` or `HM`
- `pinSalt`: unique cryptographically random salt
- `pinHash`: bcrypt hash of the PIN using that salt
- `isActive`: boolean
- `displayName`: display name

For HM accounts also store `hmCode`, `primaryRank` (HM_PR/HM1/HM2/HM3), and optional `extraRank` (MR/SR/SE/SO/TSM/ASM/RSM).

The website and Android clients must call `loginWithPin`, then sign in to Firebase Auth with the returned custom token. They must not read PIN/password fields from `health_mitras` or trust role values from localStorage.

## Role policy
- HQ_SUPER_ADMIN and HQ_ADMIN retain administrative permissions.
- BILLING_SONALI and BILLING_KOUSHIK are billing roles.
- MEDICINE_INCHARGE_GOPAL, MEDICINE_INCHARGE_MILAN, MEDICINE_INCHARGE_JEET manage Raw Material and Ready Medicine.
- HEALTH_MITRA is limited to the signed-in HM's permitted data.

## Required before deployment
1. Confirm the official staff login identifiers and map them to the allowlisted role codes.
2. Generate a separate random salt and bcrypt hash for each PIN using a secure local process. Do not commit PINs, hashes, salts, service-account keys, or secrets to Git.
3. Bootstrap the first HQ Super Admin account through a trusted administrative process.
4. Migrate HM passwords to server-managed credentials; do not use the legacy plaintext `health_mitras.password` field.
5. Add App Check, stronger IP/device-aware throttling, monitoring, and account recovery before production.
6. Wire Website and Android Firebase Auth sign-in and sign-out.
7. Audit all Firestore reads/writes and then prepare least-privilege Firestore Rules.
8. Test in a non-production Firebase project before deployment.

## Important
- This prototype currently uses a per-login-ID rate limit. It is not sufficient as the only production abuse control.
- App Check is not enforced yet.
- Do not deploy until account provisioning, App Check, client integration, migration, and Rules tests are complete.
- Do not delete old HM, billing, ledger, inventory, or price data as part of authentication setup.
