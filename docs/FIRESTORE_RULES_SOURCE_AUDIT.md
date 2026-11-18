# UB AYURVED Firestore Rules Review — Source Audit

Date: 2026-11-18
Branch: `hm-google-email-auth-v1`
Repository: `cyberspacebelda-dot/UB-Website`

## Confirmed access decision

Medicine documents are restricted to approved Staff and Admin only. Public customers, unauthenticated users, pending Health Mitras, and rejected Health Mitras must not read `medicines`.

## Live Rules observation

The connected Firebase Console tab is open to the Android Firestore database:
`ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2`.

The displayed Rules editor contains the same rules supplied for this review. The project is marked Production. No Rules were edited or published during this audit.

## Website source audit (branch snapshot)

File inspected: `app.js` on `hm-google-email-auth-v1`.

### Reads / real-time listeners

At module startup, `initFirestoreListeners()` starts listeners without waiting for authentication or approval:

- `health_mitras` — full collection listener; reads profile fields including password, rank, verification state, balances, and sales totals.
- `bills` — full collection listener; reads billing, patient, payment, verification, delivery, and stock fields.
- `medicines` — full collection listener.
- `commission_config/medicine_price_list_2026` — reads JSON price overrides.
- `commission_config/incentive_rules_v2` — reads incentive percentages and member overrides.
- `ledger` — full collection listener.

This startup pattern is incompatible with the intended role-based access model. Listeners must be initialized only after Firebase Auth has resolved and the signed-in identity has been authorized. HM sessions must not subscribe to staff-only collections. The browser must not download full HM, bills, or ledger collections and then filter locally.

### Authentication / session

- Office login compares a PIN against client-side `OFFICE_ROLES` and stores a role object in localStorage.
- HM login searches the already downloaded `health_mitras` array using HM code/mobile and compares a password field stored in Firestore, with a default `123456` fallback.
- HM session is stored in localStorage.
- No Firebase Auth sign-in is present in the inspected login handlers.
- UI flags such as `canEditMedAndHm`, `canVerifyBilling`, and `isSuperAdmin` are client-side state, not trusted authorization.

Consequently, client-side UI gating cannot be treated as a security boundary. Office login also needs a separate server-verifiable identity/role design before production Rules can safely authorize staff access. The migration must preserve the existing Office UX, but the current client PIN implementation cannot be accepted as proof of identity by Firestore Rules.

### Writes and schema compatibility

Website code writes to:
- `health_mitras/{hmCode}` for registration, profile edits, and rank promotion.
- `medicines/{id}` for medicine and stock data.
- `commission_config/medicine_price_list_2026`.
- `commission_config/incentive_rules_v2`.
- `bills/{billId}` for challan creation and status/delivery updates.

The registration form allows the client to choose HM code, rank, password, verification state (indirectly through the Office flag), and other privileged fields. This must be replaced with a UID-keyed registration request. HM code/rank/approval must be assigned by trusted approval logic, not applicant input.

### Medicine schema conflict requiring resolution

The Rules validator currently accepts only `AVAILABLE`, `LOW_STOCK`, or `OUT_OF_STOCK`. The inspected website medicine writer sets `status` to `IN_STOCK` or `OUT_OF_STOCK`. Therefore, a strict deployment of the current validator would reject website writes with `IN_STOCK`. The canonical status vocabulary must be aligned with the Android app and website before enforcement.

The validator also requires `slNo` to be an integer and several fields to have specific types. These requirements must be checked against actual Android writes and existing medicine documents before deployment.

## Collection-by-collection target policy (design; not deployed)

| Collection | Target read policy | Target write policy |
|---|---|---|
| `medicines` | Approved Staff + Admin only | Authorized inventory staff/Admin; validate schema and immutable fields |
| `inventory_logs` | Admin / explicitly authorized audit roles | Trusted backend or authorized staff with strict schema; immutable after create |
| `admins` | Admin self-record or trusted admin workflow only; never public list | Trusted server/Admin SDK only |
| `health_mitras` | Super Admin and explicitly authorized staff; HM only their own approved profile | Trusted approval workflow; HM may update only narrowly allowed self-profile fields |
| `hm_registration_requests` | Applicant reads own request; Super Admin reviews | Applicant creates own pending request; approval/status fields server-controlled |
| `bills` | Authorized Staff/Admin; HM only own scoped bill records if required | Role- and ownership-scoped operations; immutable financial fields / validated state transitions |
| `returns` | Authorized Staff/Admin; HM only own records if required | Role- and ownership-scoped operations with validated transitions |
| `ledger` | Admin/authorized finance roles; HM only own permitted ledger view | Prefer trusted backend; no unrestricted client writes |
| `commission_config` | Approved Staff/Admin only as required; HM should receive only safe derived values | Super Admin / trusted backend only |

## Critical implementation blockers

1. The Android source repository/project source has not yet been directly inspected in this branch audit. The AI Studio browser context shows prior Android project work, but it does not provide a verifiable complete source snapshot for every Firestore read/write. Do not infer Android collection permissions from website code.
2. The Website's current Office PIN flow is client-side and cannot securely establish staff identity to Firestore Rules.
3. No Firebase Functions/backend approval implementation is present in the inspected Website repository root.
4. No authoritative Firestore Rules file, Firebase CLI config, or Emulator test suite exists in the inspected repository root.
5. The deployed schema for `health_mitras`, `bills`, `returns`, and `ledger` must be reconciled with Android code and real document examples.
6. Existing `admins` documents and the hard-coded email allowlist need a controlled migration to trusted Admin claims/records. Client-side writes must never grant Admin status.

## Ordered implementation plan

1. Complete a read-only Android source audit for every Firestore collection, query, listener, and write (including payment, billing, returns, ledger, medicine, HM profile, and commission stores).
2. Export/inspect representative document schemas and all relevant subcollections for the Android database and Dashboard database. Do not modify or delete data.
3. Define canonical role claims: Super Admin, approved Staff roles, approved HM, pending HM, rejected HM. Explicitly exclude obsolete roles not in the approved permission matrix.
4. Implement trusted backend identity provisioning and Admin approval (Firebase Admin SDK / Cloud Functions or equivalent secured server). The browser must not be able to assign HM code, rank, approval, role, or Admin status.
5. Add Firebase Auth to the Website HM flow: Google Sign-In and Email/Password with verified email; create `hm_registration_requests/{uid}`; pending/rejected users remain blocked from business data.
6. Migrate Office authentication to a server-verifiable role while preserving the existing Office UX and role separation. Do not treat localStorage or a client PIN as trusted authorization.
7. Gate every Website listener and write behind Firebase Auth state and server-authorized role. Remove global collection downloads and local-only filtering.
8. Align medicine schema/status values and timestamp types across Android and Website. In particular resolve `IN_STOCK` versus `AVAILABLE` / `LOW_STOCK`.
9. Write deny-by-default Rules with explicit per-collection and per-operation permissions. Protect Admin records and finance/config writes with trusted claims/server-side authorization.
10. Add Firebase Emulator tests for unauthenticated, pending HM, rejected HM, approved HM, each Staff role, Admin, and Super Admin. Include read, list, create, update, delete, ownership, and field-tampering cases.
11. Run app and website regression tests: login, medicine reads, stock updates, HM registration/approval, billing, returns, ledger, commission sync, and Office workflows.
12. Only after all tests pass, schedule a controlled Rules deployment and staged website release. Do not merge this branch or deploy to Production before explicit approval.

## Safety status

- No Production Rules edited or published.
- No Firestore data changed.
- No Authentication users changed.
- No source code changed by this audit.
- No branch merge or deployment performed.
