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

1. Reconcile the Firebase project discrepancy: Android audit project number `297378462371` versus the existing preview's `893264713046`.
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
