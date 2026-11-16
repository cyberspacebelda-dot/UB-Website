# UB AYURVED Firestore Source Audit
## Status
Website source audit completed for branch `firebase-sync-setup`. Android source audit is blocked because the connected GitHub integration returns 404 for repository `cyberspacebelda-dot/UB-DASHBOARD-APK` and no installed-repository entry is available. This report is not authorization to deploy rules or change Firebase data.

## Website Firestore configuration
- Firebase project: `ub-ayurved`.
- Named Firestore database: `ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2`.
- `app.js` attempts to initialize the named database but falls back to the default database if initialization throws. Remove this fallback before production hardening; a wrong-database fallback is unsafe.

## Website reads/listeners observed in `app.js`
The app starts these listeners immediately during page initialization, before login or verified Firebase Auth role resolution:
- Collection `health_mitras` (entire collection)
- Collection `bills` (entire collection)
- Collection `medicines` (entire collection)
- Document `commission_config/medicine_price_list_2026`
- Document `commission_config/incentive_rules_v2`
- Collection `ledger` (entire collection)

The HM listener reads fields including password, mobile, address, sponsor, rank, verification state, credit balance and sales totals. This is incompatible with least-privilege HM access and exposes plaintext password material. The bills and ledger listeners are also unscoped.

## Website writes observed in `app.js`
- `commission_config/medicine_price_list_2026`: writes price override JSON.
- `medicines/{id}`: writes medicine records and stock-related fields when saving medicine overrides.
- `health_mitras/{hmCode}`: creates HM records; profile/rank updates and verification updates also write this collection.
- `bills/{billId}`: creates bills/challans, verifies billing status, and updates delivery status.
- `commission_config/incentive_rules_v2`: writes global/member incentive settings.

The code uses client-side office PIN checks, plaintext HM password comparison, and `localStorage` role/session data. These are not authorization boundaries. Firebase Phone Auth and trusted role claims/profiles are not yet wired into this `app.js` login/listener flow.

## Collections/features not located in Website `app.js`
- No explicit Firestore collection operations for returns were found.
- No raw-material collection or raw-material stock movement operations were found.
- No explicit inventory-log writes were found in this source file.
These features may exist in Android or other source files/services; absence from this file does not prove absence from the product.

## Role-matrix implications
- Sonali/Koushik's confirmed HM profile and medicine/stock management duties align with observed Website write paths, but granular field separation and operation validation are still needed.
- Jeet's confirmed returns, stock movements and raw-material oversight are not represented in the inspected Website Firestore operations. Their exact collection names, fields, and workflows must be discovered from Android/backend source before allowing access.
- Gopal/Milan view-only billing + production/stock access cannot be safely implemented by granting reads to broad mixed documents until sensitive fields are separated or projected.
- HM self-service needs UID-to-HM mapping and scoped queries; current Website implementation loads all HM records and compares client-readable passwords, so it cannot be secured merely by adding broad collection read rules.

## Blocking items before final rules
1. Obtain Android source access or have the user provide the Android project/source archive. Required review includes every Firestore collection/document read, create, update, delete, listener, batch, and transaction, including the raw-material and return flows.
2. Review Android destructive purge/sync paths, especially any logic that can delete business collections.
3. Identify actual raw-material and return collection/document schemas and map them to the permission matrix.
4. Refactor Website authentication/listeners to Firebase Auth + trusted role resolution; start scoped listeners only after authorization.
5. Remove plaintext HM password storage/comparison and the named-database fallback.
6. Add staging/emulator tests for every confirmed role and operation. Keep production rules unchanged until review and explicit approval.
