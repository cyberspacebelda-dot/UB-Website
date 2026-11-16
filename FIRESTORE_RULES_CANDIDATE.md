# Firestore Security Rules — Candidate (Not Deployed)

Branch: `firebase-sync-setup`

## Status
This is a candidate lockdown ruleset for review and Emulator testing only. It has NOT been published to Firebase.

## Why this is a staged lockdown
The current production rules allow unauthenticated read/write access to health_mitras, bills, returns, ledger, commission_config, inventory_logs and admins. The candidate closes these paths immediately in the rules file. This will intentionally break current app features that still depend on those paths until their authentication and role-based rules are migrated.

## Candidate policy
- `office_staff_auth/{uid}`: a signed-in phone-auth user can get only their own profile if UID, verified phone claim, and active status match. No client create/update/delete/list.
- Office admin elevation uses only the trusted custom claim `officeAdmin == true`. A client-writable `admins/{uid}` document and email string are not accepted as admin proof.
- `medicines`: public read retained; writes require the trusted custom claim and existing field validation.
- `health_mitras`, `bills`, `returns`, `ledger`, `commission_config`, `inventory_logs`, `admins`: deny until a reviewed per-role access matrix and server-side identity mapping exist.
- Catch-all deny.

## Important limitations / prerequisites
1. Firestore Rules cannot safely create Auth users, assign custom claims, or provision Office profiles. Use a trusted Admin SDK backend (for example a callable Cloud Function with strict authorization) for provisioning.
2. No custom claims have been assigned. Therefore no user currently qualifies as `officeAdmin` for medicine writes under this candidate.
3. A profile must be created by a trusted backend with fields `uid`, `phoneE164`, `role`, `category`, `active`, and `displayName`. The backend must validate role assignment; never trust client-submitted role fields.
4. The staging test UID is not an Office account and must not be granted SUPER_ADMIN.
5. Do not deploy this candidate to production until emulator tests pass, the exact Android and Website data access matrix is agreed, a backup/restore is verified, and a controlled migration window is planned.
6. Production database ID is named: `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2`. Ensure the Emulator and any eventual deployment target the intended database.
7. Existing HM plaintext password fields require a separate secure migration; these rules deny client reads until that migration is complete.

## Run locally
Install dependencies with `npm install`, then run `npm run test:rules`. Firebase CLI starts the Firestore Emulator for the test suite. No production data is contacted by the Emulator tests.

## Expected tests
- Own active office profile read: allow.
- Other UID profile read: deny.
- Client role-profile creation: deny.
- Bills and HM record read: deny for anonymous and signed-in non-admin users.
- Public medicine read: allow.
- Medicine write: deny without trusted custom claim; allow with trusted custom claim.
