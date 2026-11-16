# UB AYURVED Version-Controlled Business Configuration Design
## Decision confirmed by the user
- Configuration managers: `SUPER_ADMIN` and `OFFICE_ADMIN`.
- Activation approval: none. An authenticated, active user with either trusted role may publish a validated new configuration version directly.
- `BILLING_STAFF` (including Sonali and Koushik), `DELIVERY_STAFF` (Jeet), `BILLING_PRODUCTION_VIEWER` (Gopal and Milan), and `HEALTH_MITRA` cannot create, edit, publish, archive, or roll back configuration versions.
- This is a design specification only. No Firebase data, Auth users, deployed Rules, Android code, or Website code is changed by this document.

## Goals
1. Allow price, commission, incentive, and payout/payment rules to change without app releases.
2. Preserve the exact terms used by every historical bill, order, commission calculation, and payout.
3. Keep configuration changes attributable and auditable.
4. Synchronize Android and Website against the same named Firestore database and active configuration pointer.
5. Never delete historical configuration versions or business records as part of normal configuration management.

## Configuration domains
Use four independent version streams:
- Medicine price catalogue
- Commission rules
- Incentive rules
- Payment / payout rules

Each stream has its own monotonically increasing version number and active-version pointer. Example: medicine price V3 can be active while commission V2, incentive V5, and payment V1 remain active. Do not force all domains to share one version number.

## Proposed Firestore layout
The following is a logical schema proposal. Final collection names and field names must be checked against Android and Website source before implementation.

```text
business_config/
  active/
    current
      medicinePriceVersion: 3
      commissionVersion: 2
      incentiveVersion: 5
      paymentVersion: 1
      updatedAt
      updatedByUid

  medicine_price_versions/
    v0001
    v0002
  commission_versions/
    v0001
    v0002
  incentive_versions/
    v0001
    ...
  payment_versions/
    v0001
    ...

business_config_audit/
  {eventId}

business_config_counters/
  medicine_price
  commission
  incentive
  payment
```

Firestore collection nesting note: the path above is conceptual. In Firestore, each collection/document path must alternate correctly; implement each version stream as a top-level collection (recommended: `medicine_price_versions/{versionId}`, `commission_versions/{versionId}`, `incentive_versions/{versionId}`, `payment_versions/{versionId}`), with `business_config/active` as a document and `business_config_audit/{eventId}` as audit events. Avoid creating a document path with an invalid collection/document parity.

## Version document fields
Every immutable version document should include:
- `versionId` (e.g. `v0003`)
- `domain` (`medicine_price`, `commission`, `incentive`, `payment`)
- `status` (`active`, `superseded`; drafts may be local until validated)
- `effectiveFrom` (server timestamp or explicitly approved business effective time)
- `createdAt` (server timestamp)
- `createdByUid`
- `createdByRole`
- `changeReason`
- `schemaVersion`
- `payload` (domain-specific validated configuration)
- `checksum` (optional integrity aid)

Once published, a version document is immutable. Do not edit it in place or delete it. A correction creates a new version. The active pointer is the only mutable configuration control document.

## Activation and rollback
- `SUPER_ADMIN` and `OFFICE_ADMIN` may validate and activate directly; no second-person approval is required, as explicitly selected by the user.
- Activation must be a trusted atomic backend operation (Admin SDK / callable Cloud Function), not an unrestricted client write to the active pointer.
- The backend verifies caller's Firebase Auth identity, active trusted role, allowed domain, payload schema, business constraints, and monotonically increasing version.
- The backend writes the immutable version document, updates the active pointer transactionally, and appends an audit event.
- Rollback does not reactivate by mutating an old document. It creates a new version copied from a prior known-good payload, with a new version number and reason such as `rollback_to_v0002`.
- Prevent simultaneous conflicting publishes using a transaction and expected-current-version check. If another admin publishes first, reject stale activation and require refresh.
- Validate effective date/time and timezone explicitly (business timezone should be configured as Asia/Kolkata if confirmed by the app).

## Historical bill, order, commission, and payout snapshots
At the time a bill/order is created or finalized, persist:
- exact product name/code and quantity
- unit MRP, DP, sales price, GST rate/amount, retail profit, BV, and line totals used
- medicine price version ID
- commission version ID used for the transaction (if commission applies)
- incentive version ID used for eligibility/calculation (if applicable)
- payment version ID used for payout terms (if applicable)
- calculation timestamp and calculation source/version

At payout calculation/finalization, store a payout snapshot containing:
- beneficiary UID/HM code reference
- eligible base amount and source period
- applied rule version IDs
- rate/percentage and formula inputs
- gross, deductions, adjustments, net payable
- status, calculation timestamp, and finalization metadata

Historical snapshots are immutable. A future configuration change must not silently recalculate or rewrite finalized bills or payouts. If a correction is required, create a separately recorded adjustment/reversal linked to the original transaction; do not overwrite history.

## Admin workflow
1. Admin opens Configuration Management.
2. App loads active version IDs and the current version payloads.
3. Admin edits a working copy; the active version remains unchanged while editing.
4. App performs client-side preview/validation for usability only.
5. Trusted backend repeats all validation and authorization.
6. Backend creates a new immutable version, switches the active pointer, and records an audit event atomically.
7. Android and Website listeners receive the active-version pointer and load the matching immutable version.
8. Each new bill/order/payout captures the versions it actually used.

No approval step is inserted because the user selected direct activation by SUPER_ADMIN and OFFICE_ADMIN.

## Security and Firestore access policy
- Configuration version reads: grant only the minimum required read access. Apps may need published configuration reads for calculations; do not expose private cost or commission fields to Health Mitras unless required and explicitly approved.
- Configuration writes: clients cannot directly create/update/delete version documents, counters, audit records, or active pointers.
- Publish endpoint: trusted backend checks custom claims or a trusted UID-keyed role profile. Never trust `localStorage`, client-supplied role strings, email text, or a writable `admins` document.
- Audit records: append-only, backend-created; clients cannot edit/delete.
- Only SUPER_ADMIN / OFFICE_ADMIN can invoke publish/rollback backend actions.
- Billing/Delivery/Viewer/HM roles are denied all configuration management writes.
- Firestore Rules cannot safely redact selected fields from a document. If HM/public clients need only a subset of the price catalogue, publish a separate safe read projection containing only approved fields.
- The current candidate rules deny all `commission_config` access. Do not weaken them broadly. Migrate to the new model only after both apps are updated and Emulator tests prove every role's intended access.

## Compatibility and migration requirements
- Existing Website currently reads/writes `commission_config/medicine_price_list_2026` and `commission_config/incentive_rules_v2`. These legacy paths must remain readable during a planned compatibility migration or be replaced in both apps in one coordinated release. Do not delete the legacy documents.
- Existing Android code paths must be audited for current price/incentive collections and fields before choosing payload schemas.
- Keep existing billing, medicine price calculations, commission formulas, sponsor logic, rank logic, and payout calculations behaviorally equivalent during migration. Add golden test cases comparing old and new calculation outputs.
- Do not change the current production data or active configuration until backup/restore and staging validation are complete.

## Required tests before deployment
1. SUPER_ADMIN can publish each configuration domain.
2. OFFICE_ADMIN can publish each configuration domain.
3. BILLING_STAFF, DELIVERY_STAFF, BILLING_PRODUCTION_VIEWER, and HEALTH_MITRA cannot publish, edit, delete, or roll back configuration.
4. Anonymous users cannot read private configuration or invoke publish.
5. Published version documents cannot be updated or deleted by clients.
6. Active pointer changes only through the trusted backend.
7. Invalid rates, negative prices, malformed percentages, invalid effective dates, and unknown fields are rejected.
8. Concurrent publishes cannot silently overwrite one another.
9. Rollback creates a new version and preserves prior versions.
10. Historical bill/payout snapshots remain unchanged after later configuration activation.
11. Android and Website load the same active version IDs from the configured named database.
12. Legacy-to-versioned migration produces identical calculation results for agreed test cases.

## Open design items before implementation
- Confirm whether `OFFICE_ADMIN` is an actual assigned account/role today, and which UID(s) receive it. Do not infer this from ADMIN_GOPAL or ADMIN_MILAN; they are explicitly view-only. Do not elevate Sonali/Koushik from BILLING_STAFF without separate authorization.
- Audit Android and full Website source to establish exact price, commission, incentive, and payout schemas and calculation functions.
- Confirm the intended effective-time policy (immediate activation vs scheduled future effective time) and whether backdated activation is prohibited. Recommended default: immediate or future-dated only; never backdate automatically.
- Confirm which price fields may be visible to Health Mitras and public users; expose only a safe projection.
- Determine whether existing historical bills already store sufficient price/commission snapshots. If not, preserve the existing values and design a non-destructive migration; never fabricate missing historical values.
