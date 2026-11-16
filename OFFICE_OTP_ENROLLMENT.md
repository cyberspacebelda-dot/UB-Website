# Office Phone OTP Authorization Profile

This is a staged integration component on `firebase-sync-setup`. It does not create users or Firestore documents.

## Required enrollment record

After a staff member personally verifies their phone number with Firebase Phone Authentication, an authorized provisioning process must create:

`office_staff_auth/{firebaseAuthUid}`

Required fields:

- `uid`: exact Firebase Authentication UID
- `phoneE164`: verified phone number in E.164 format
- `role`: one of the role IDs below
- `category`: exact category mapped below
- `active`: boolean; must be `true`
- `displayName`: staff display name

## Role mapping

| Role | Category |
|---|---|
| SUPER_ADMIN | SUPER_ADMIN |
| ADMIN_1 | OFFICE_ADMIN |
| ADMIN_GOPAL | OFFICE_ADMIN |
| ADMIN_MILAN | OFFICE_ADMIN |
| STAFF_SONALI | BILLING_STAFF |
| STAFF_KOUSHIK | BILLING_STAFF |
| STAFF_JEET | DELIVERY_STAFF |

The client validator reads the profile only by the signed-in Firebase UID and checks UID, verified phone number, active status, role/category consistency, and display name. It never accepts a role selected by the user.

## Not yet complete

- No Firebase Auth users have been created.
- No Firestore profile documents or rules have been changed.
- The login UI and listener gating have not yet been switched over.
- A trusted provisioning route and Firestore Rules must be designed before issuing production staff profiles.
- HM OTP needs a separate trusted HM-Code-to-registered-phone resolution flow; the browser must not download all HM records to discover phone numbers.

Do not deploy this component as a complete authentication migration by itself. The legacy login and Firestore listeners remain in the application until the next integration and security-rule stages are completed and tested.
