# Office OTP Staging Test Procedure

## Current status
The isolated `office-otp-staging.html` page is committed to `firebase-sync-setup`. It is not linked from the production website and must not be deployed publicly until the controls below are reviewed.

## Before sending a real SMS
1. Confirm the page is served only from a controlled staging origin.
2. Confirm that origin is listed under Firebase Authentication > Settings > Authorized domains.
3. Configure Firebase Authentication SMS region policy to allow only the countries required for the test.
4. Review Firebase SMS quotas, billing, and abuse protections. reCAPTCHA is required but does not make an unrestricted public test page safe.
5. Use Firebase Authentication test phone numbers and fixed test codes for UI/flow testing where possible; these do not send real SMS.
6. Do not put a phone-number allowlist or privileged role assignment only in browser JavaScript. Client-side restrictions are not authorization.
7. Do not create `office_staff_auth/{uid}` until the staff member has personally verified the phone and an authorized provisioning process has confirmed the role.
8. Never ask staff to send OTP codes to an administrator or to ChatGPT.

## Expected test outcomes
- Valid test phone + valid test code, but no office profile: authentication succeeds, Office access is denied, and UID is displayed for controlled provisioning.
- Valid test phone + active UID-bound profile: profile validator accepts only if UID, phoneE164, role/category, active=true, and displayName all match.
- Inactive profile, wrong UID, wrong phone, unknown role, or category mismatch: access is denied.
- Invalid or expired OTP: Firebase rejects verification.

## Important limitations
- This staging page does not open the production dashboard.
- It does not gate the main app's Firestore listeners.
- It does not replace the existing Office PIN or HM password login.
- It does not enforce authorization in Firestore Security Rules.
- No Auth users, Firestore profiles, or Firestore Rules are created or modified by this procedure.

Do not treat this staging page as production-ready authentication. Complete server-side/Firestore Rules authorization and the main-app integration before production rollout.
