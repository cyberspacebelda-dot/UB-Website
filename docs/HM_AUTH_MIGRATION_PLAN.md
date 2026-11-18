# HM Authentication Migration — aligned with unified role migration

The original isolated HM preview remains a non-production prototype. The approved scope has since expanded to migrate **all Android roles and the connected website** to Firebase Authentication.

The authoritative plan is now:
- `docs/FIREBASE_AUTH_MIGRATION_ANDROID_WEB.md`

## Approved role naming

- `SUPER_ADMIN`: temporarily designated as `cyberspacebelda@gmail.com`; changeable later through a privileged, audited provisioning process.
- `STAFF_GOPAL`: exact Google email pending.
- `STAFF_MILAN`: exact Google email pending.
- `STAFF_SONALI`: `sonalidas747774@gmail.com`.
- `STAFF_KOUSHIK`: `koushikghosh585@gmail.com`.
- `STAFF_JEET`: `swagatahazra2005@gmail.com`.
- `VERIFIED_HM`, `PENDING_HM`, and `PUBLIC_CUSTOMER` as defined in the unified plan.

There are no `ADMIN_2` or `ADMIN_3` roles. Gopal and Milan are Staff, not Admins.

## Existing HM preview status

The files `hm-auth-preview.html` and `hm-auth-preview.js` remain isolated preview artifacts. They are not integrated into the main portal and are not production-ready. In particular, the preview must not be treated as evidence that the Firebase project configuration, Firestore Rules, or trusted approval flow has been validated.

## Mandatory blockers

1. Firebase project identity is reconciled from the owner-supplied Web config and uploaded Android `google-services.json`: both identify `ub-ayurved` / project number `893264713046`. The older audit's `297378462371` conflicts with the actual uploaded config and is treated as stale/incorrect for this checkpoint. Authentication provider enablement, authorized domains, OAuth linkage, signing SHA-1, and named Firestore database selection still require read-only verification.
2. Confirm the exact named Firestore database and remove any default-database fallback.
3. Obtain Staff Gopal and Staff Milan exact Google email addresses.
4. Inspect the complete Android source and precompiled JAR integration before changing login or repository code.
5. Implement trusted UID-based role provisioning and HM approval; client-side role flags and office PINs are not authorization.
6. Gate every listener and data operation on Firebase Auth plus trusted role resolution.
7. Enforce the owner's explicit medicines policy: only approved Staff and Super Admin may read medicines. HM (including approved HM), Pending HM, Public Customer, and unauthenticated users must be denied.
8. Export and audit the deployed Rules and collection/subcollection schemas, then pass Firebase Emulator cross-role tests.

## Safety boundary

No Production Firestore Rules, live data, Firebase Auth users, `main` branch, or deployment may be changed as part of this planning checkpoint. Do not merge or deploy without separate explicit approval.

## Confirmed staff role mapping — 2026-11-18

The owner confirmed the following interim identity mapping for the authentication migration:

| Account | Target role | Provisioning status |
|---|---|---|
| `cyberspacebelda@gmail.com` | `SUPER_ADMIN` | Email designated; trusted UID/claim provisioning still pending |
| Staff Sonali | `STAFF_SONALI` | Email supplied; verify exact Firebase Auth UID before provisioning |
| Staff Koushik | `STAFF_KOUSHIK` | Email supplied; verify exact Firebase Auth UID before provisioning |
| Staff Jeet | `STAFF_JEET` | Email supplied; verify exact Firebase Auth UID before provisioning |
| Staff Gopal | `STAFF_GOPAL` | Unassigned — email to be supplied later |
| Staff Milan | `STAFF_MILAN` | Unassigned — email to be supplied later |

- Do not create placeholder Auth accounts or grant Gopal/Milan roles by display name, client selection, or email substring.
- Do not retain or introduce `ADMIN_2`, `ADMIN_3`, `ADMIN_GOPAL`, or `ADMIN_MILAN` as privileged roles. Gopal and Milan are Staff roles only.
- Super Admin email designation is provisional until the corresponding Firebase Auth UID is verified and a trusted Admin SDK/custom-claims provisioning process is implemented.
- Later changes to the Super Admin identity must use the trusted provisioning process, with an auditable transfer/revocation sequence.
- These are branch planning changes only. No Auth users, custom claims, Firestore documents, Rules, production data, or deployment were changed.


## Firebase configuration reconciliation — 2026-11-18

The owner supplied the Web Firebase SDK config and uploaded Android `google-services.json`. Both agree on Firebase Project ID `ub-ayurved` and Project Number / messaging sender ID `893264713046`. Android package is `com.aistudio.ubayurved.plkrtw`; Android app ID is `1:893264713046:android:8964bf3f130a0b90cff2f7`; Web app ID is `1:893264713046:web:1bc7da53d88c7c0bcff2f7`; Web auth domain is `ub-ayurved.firebaseapp.com`.

The previous audit's `297378462371` is inconsistent with the uploaded Android config and is not used as the source of truth for this checkpoint. Distinct Android and Web API keys are expected for separate Firebase app registrations.

Still to verify in Firebase Console: Google and Email/Password provider enablement, authorized domains, OAuth linkage, actual APK signing SHA-1, and the named Firestore database existence/region and web initialization. No Firebase Auth users, claims, Firestore data, Rules, production settings, or deployment were changed.
