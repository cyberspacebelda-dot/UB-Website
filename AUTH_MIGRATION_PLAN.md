# UB AYURVED Authentication Migration Plan

**Repository:** cyberspacebelda-dot/UB-Website  
**Branch:** firebase-sync-setup  
**Firebase project:** ub-ayurved  
**Firestore database:** ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2

## Approved direction

Migrate Website and Android sign-in toward Firebase Authentication and stop treating browser-side PIN/password checks or localStorage role objects as identity.

This document is a plan only. It does not provision users, enable providers, change Firestore data/rules, revoke credentials, or modify production Firebase.

## Proposed identity model

### Office staff

- Firebase Phone Authentication (OTP), matching the Android OTP direction.
- After Firebase sign-in, load a staff authorization profile keyed by Firebase UID.
- Verify profile active status, UID, verified phone number, role, and category.
- Use one consistent role/category mapping across Android and Website.
- No office PINs in client JavaScript.

### Health Mitra / rank holders

- Firebase Authentication identity linked to the existing HM profile.
- HM Code remains a business identifier, not a password or authentication secret.
- Resolve the authenticated UID to a trusted HM profile and verify active/verified status and phone number.
- Proposed default: Phone OTP to the mobile number already registered on the HM profile. Do not infer or create accounts until the owner confirms this is the intended recovery/contact channel.
- Preserve HM rank visibility and portal permissions from the existing profile.

## Required profile fields (proposal; not yet written to Firestore)

Office profile collection: `office_staff_auth/{uid}`
- `uid`
- `phoneE164`
- `role`
- `category`
- `active`
- `displayName`

HM profile mapping (proposal; avoid duplicating personal data):
- Add an authentication UID mapping to the existing HM profile only after a verified account is provisioned.
- Retain existing HM Code, rank, sponsor, and business fields.
- Do not store passwords, OTPs, or verification secrets in Firestore.

## Migration sequence

1. Confirm the HM sign-in factor and phone-number ownership/recovery process.
2. Inventory existing HM profiles and office staff identities without exporting passwords or PINs.
3. Enable/verify Phone provider and authorized SMS regions in Firebase Authentication.
4. Provision/link accounts only after identity verification and explicit per-account approval.
5. Implement web Firebase Auth state handling; attach Firestore listeners only after authentication and role validation.
6. Remove hard-coded PIN and plaintext password authentication paths only when the replacement login has been tested and account coverage is confirmed.
7. Enforce authorization in Firestore Rules or trusted backend. UI role checks are not security controls.
8. Implement equivalent UID/profile validation in Android.
9. Test in a separate Firebase test project or emulator; production rollout requires a backup and a controlled migration window.

## Important security and compatibility notes

- The existing public repository contains hard-coded office PINs in its current source/history. Treat these PINs as exposed and rotate them through an approved operational process. Removing them from a later commit does not erase Git history.
- Existing HM profile documents currently include plaintext password fields. Do not copy those values into Firebase Auth or expose them to a migration script. Use verified phone ownership and OTP-based enrollment/password reset instead.
- Current website code starts Firestore listeners before login and restores a client-editable role object from localStorage. Both must be replaced by Firebase Auth state plus server-enforced authorization.
- The existing Android source path must be reviewed before removing legacy HM login. Preserve existing portal routing and permissions.
- No change to Firestore Rules is included in this commit. Rules need an explicit collection/action access matrix and testing before deployment.
- No Firebase Authentication users, Firestore documents, collections, indexes, or rules have been changed.

## Current implementation status

- Branch `firebase-sync-setup` created from `main`.
- Static audit report committed.
- Migration design recorded.
- Application login code not yet changed because HM's OTP destination and account linking strategy need owner confirmation.
