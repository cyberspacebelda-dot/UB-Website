# UB Ayurved canonical account and role mapping

This is the approved role map for provisioning the new `login_accounts` collection. It contains no credentials.

| Display account | Login ID | Server role | Account type | Permissions |
|---|---|---|---|---|
| Belda HQ Super Admin | `HQ-SUPER-ADMIN` | `HQ_SUPER_ADMIN` | OFFICE | Full existing HQ Super Admin access |
| Belda HQ Admin | `HQ-ADMIN` | `HQ_ADMIN` | OFFICE | Full existing HQ Admin access |
| Sonali – Billing Staff | `BILLING-SONALI` | `BILLING_SONALI` | OFFICE | Billing |
| Koushik – Billing Staff | `BILLING-KOUSHIK` | `BILLING_KOUSHIK` | OFFICE | Billing |
| Gopal – Medicine Incharge | `MEDICINE-INCHARGE-GOPAL` | `MEDICINE_INCHARGE_GOPAL` | OFFICE | Raw Material + Ready Medicine |
| Milan – Medicine Incharge | `MEDICINE-INCHARGE-MILAN` | `MEDICINE_INCHARGE_MILAN` | OFFICE | Raw Material + Ready Medicine |
| Jeet – Medicine Incharge | `MEDICINE-INCHARGE-JEET` | `MEDICINE_INCHARGE_JEET` | OFFICE | Raw Material + Ready Medicine |
| Health Mitra | Actual HM Code | `HEALTH_MITRA` | HM | Own HM account, rank-based prices and permitted HM features |

## Important mapping notes
- Gopal and Milan are Medicine Incharge staff, not Admin accounts.
- Jeet has the same Raw Material + Ready Medicine management permission as Gopal and Milan.
- Sonali and Koushik are Billing Staff; they do not receive Medicine Incharge permissions.
- HQ Super Admin and HQ Admin retain their respective existing HQ permissions.
- HM login ID is the actual HM Code. Mobile-number login aliases are not provisioned by this map.
- HM primary rank is one of `HM_PR`, `HM1`, `HM2`, `HM3`. Optional Extra Rank is one of `MR`, `SR`, `SE`, `SO`, `TSM`, `ASM`, `RSM`.
- Legacy PINs and plaintext HM passwords must not be copied into the new collection.
- This mapping does not create accounts or alter existing data. Run the provisioning utility separately in a controlled environment after verifying each account owner and initial credential.
