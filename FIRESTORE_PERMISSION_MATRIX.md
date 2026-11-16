# UB AYURVED Firestore Permission Matrix
## Status
Draft for review only. This document does not change Firebase Authentication users, Firestore data, or deployed Firestore Rules. Do not publish rules from this matrix until Android and Website operations have both been verified.

## Identity and authorization model
- Authentication: Firebase Phone Authentication; authorization comes from a trusted profile / server-controlled custom claims, never from a client-selected role or localStorage.
- Office profile: `office_staff_auth/{uid}`, provisioned only by a trusted administrative process. Client SDKs cannot create, update, or delete these profiles.
- Health Mitra: Firebase UID must be mapped to exactly one existing HM record through a trusted mapping (for example, a UID field or separate UID-keyed mapping). HM Code is an identifier, not a password.
- A signed-in phone number alone does not grant Office or HM business-data access.
- All access must be scoped to the minimum required documents and fields. Avoid allowing an HM to list all HM records or bills.

## Role mapping
| Existing Website role | Canonical category | Notes |
|---|---|---|
| SUPER_ADMIN | SUPER_ADMIN | Full operational administration, subject to audited rules |
| ADMIN_1 | REMOVED / NOT USED | Do not provision this role; remove its login/profile entry from the future auth migration. Existing historical records must be reviewed before any deletion. |
| ADMIN_GOPAL | BILLING_PRODUCTION_VIEWER | View billing and production/stock only; no edit, delete, verification, member administration, or configuration permissions unless separately approved |
| ADMIN_MILAN | BILLING_PRODUCTION_VIEWER | View billing and production/stock only; no edit, delete, verification, member administration, or configuration permissions unless separately approved |
| STAFF_SONALI | BILLING_STAFF | User-confirmed scope: billing, HM registration/profile management, and medicine price/stock management; no commission configuration or admin account management. Exact write fields/workflows remain subject to source audit. |
| STAFF_KOUSHIK | BILLING_STAFF | User-confirmed scope: billing, HM registration/profile management, and medicine price/stock management; no commission configuration or admin account management. Exact write fields/workflows remain subject to source audit. |
| STAFF_JEET | DELIVERY_STAFF | User-confirmed scope: view bills, update delivery status, manage returns and stock movements, and oversee raw-material stock. Access must be limited to operational documents; no commission configuration or admin account management. |

## Proposed collection matrix
Legend: R = read, C = create, U = update, D = delete, Own = own/mapped record only, Scoped = only documents/fields needed for assigned task, — = deny by default.

| Collection | SUPER_ADMIN | OFFICE_ADMIN | BILLING_STAFF | DELIVERY_STAFF | HEALTH_MITRA |
|---|---|---|---|---|---|
| office_staff_auth | R (own + admin lookup via trusted backend); C/U/D via trusted backend only | same | Own R only | Own R only | — |
| health_mitras | R/C/U/D | — | R; C/U only if explicitly delegated for member onboarding | — | Own R; narrowly scoped own-profile updates only |
| bills | R/C/U/D | R/C/U | R/C; update only billing/payment fields | R; U only delivery status and delivery metadata | Own/mapped bills R; create own orders only through validated workflow |
| returns | R/C/U/D | R/C/U | R/C/U within billing workflow | Scoped R/C/U for operational returns; no deletion by default | Own/mapped return R/C only through validated workflow |
| medicines | R/C/U/D | R/C/U | R; U only if medicine editing is explicitly retained | R (delivery/stock lookup only) | R to published price/catalogue fields only |
| commission_config | R/C/U/D | R; U only delegated settings | — | — | — |
| ledger | R/C/U/D | R; write only via trusted billing workflow | R; create/update only through validated billing workflow | — | Own/mapped balance summary R only; no direct writes |
| inventory_logs | R/C/U/D | R; writes through trusted stock workflow | R; write only if stock posting is part of billing workflow | Scoped R/C for stock movements; append-only audit entries, no delete | — |
| raw_materials (collection to verify) | R/C/U/D | R/C/U if delegated | R; U only if explicitly delegated | Scoped R/C/U for raw-material stock oversight; no delete by default | — |
| raw_material_stock_movements (collection to verify) | R/C/U/D | R; writes through trusted stock workflow | R if required for billing | Scoped R/C; append-only movement records, no delete | — |
| admins (legacy) | — | — | — | — | — |
| Billing & production/stock viewing role | — | — | — | — | ADMIN_GOPAL: R (billing + stock only); ADMIN_MILAN: R (billing + stock only) |

## Website operations observed in current source
The current Website `app.js`:
- Subscribes to `health_mitras`, `bills`, `medicines`, `commission_config/medicine_price_list_2026`, `commission_config/incentive_rules_v2`, and `ledger` before login/profile authorization.
- Creates/updates `health_mitras` during HM registration and profile/rank/verification changes.
- Creates `bills` and updates payment/delivery status.
- Writes medicine and commission configuration.
- Reads plaintext HM passwords from `health_mitras` and uses browser-side PIN/password checks.
These patterns must be refactored: listeners should start only after verified identity and role; plaintext passwords and client-side PIN authorization must be removed after tested migration; all writes must be authorized by Firestore Rules or trusted backend validation.

## Required implementation constraints
1. Never trust `localStorage`, a form-selected role, a client-supplied display name, or a client-supplied `isAdmin` flag.
2. Do not permit broad `list` access to `health_mitras`, `bills`, or `ledger` for ordinary HM accounts.
3. Prefer callable Cloud Functions / trusted backend for multi-document business operations, incentive calculations, ledger posting, and role provisioning.
4. Use field-level validation and immutable audit metadata (creator, timestamps, status transitions). Firestore Rules cannot safely enforce arbitrary business workflows or secret field redaction from a document returned to a client.
5. Separate public medicine catalogue fields from private stock/cost/administrative fields if clients with different roles need different visibility.
6. Remove the Website fallback from the named Firestore database to the default database; silently connecting to another database is unsafe.
7. Keep deny-by-default rules until each actual Android and Website operation has a verified allow rule and emulator test.

## Open decisions before final rules
- ADMIN_1 is not required and should not be provisioned. Before removing any existing Firebase Auth user or Firestore profile, identify whether one exists and obtain explicit approval; do not delete historical business records.
- Confirm whether ADMIN_GOPAL and ADMIN_MILAN may edit HM profiles, medicines, billing, returns, and ledger.
- Sonali and Koushik: user confirmed billing, HM registration/profile management, and medicine price/stock management; commission configuration and admin account management are excluded. Confirm exact permitted operations/fields against both apps before final rules.
- Jeet: user confirmed bill viewing, delivery-status updates, returns management, stock movements, and raw-material oversight. Verify exact raw-material collections, fields, and whether oversight includes purchase/receipt entries or only stock tracking before final rules.
- HM permissions: user confirmed own-profile updates, own bills, order placement, return requests, and own balance visibility. Restrict all access to the authenticated HM's mapped records; orders/returns must use validated workflows and balance is read-only.
- Android source-level read/write audit is still pending; this draft is not yet an Android-verified matrix.


## Confirmed Health Mitra permissions (user-confirmed)
- A Health Mitra may update only their own permitted profile fields.
- A Health Mitra may view only their own/mapped bills and place orders through the validated order workflow.
- A Health Mitra may submit return requests for their own/mapped orders only.
- A Health Mitra may view only their own balance summary; no direct ledger writes or balance edits.
- The HM UID-to-record mapping must be trusted and must not rely on a client-supplied HM code alone.

## Confirmed Jeet permissions (user-confirmed)
- JEET may view bills and update delivery status.
- JEET may manage returns and stock movements within the operational workflow.
- JEET is responsible for raw-material oversight. Until the underlying schema is audited, interpret this as scoped raw-material stock read/create/update access, with no delete permission by default.
- Stock and movement history should be append-only where possible; corrections should be recorded as compensating movements rather than deleting history.

## Confirmed additional restriction (user-confirmed)
- ADMIN_GOPAL and ADMIN_MILAN are view-only users for Billing and Production/Stock.
- They must not create, edit, delete, verify, deliver, change member profiles, change medicines/prices, change commission settings, or write ledger entries.
- The exact Firestore collections and fields that implement the Production/Stock screens must be verified against both apps before granting read access. Do not assume every field in a mixed document is safe to expose; split sensitive fields/documents or use a trusted backend projection where needed.
