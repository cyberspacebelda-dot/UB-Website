import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { auth } from "./firebase-auth.js";

// The role is read only from office_staff_auth/{Firebase UID}; never from a
// form field, URL, localStorage value, or client-selected role.
const FIRESTORE_DATABASE_ID = "ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2";
const db = getFirestore(auth.app, FIRESTORE_DATABASE_ID);

const ROLE_CATEGORIES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN_GOPAL: "OFFICE_ADMIN",
  ADMIN_MILAN: "OFFICE_ADMIN",
  STAFF_SONALI: "BILLING_STAFF",
  STAFF_KOUSHIK: "BILLING_STAFF",
  STAFF_JEET: "DELIVERY_STAFF"
};

function normalizePhone(value) {
  return String(value || "").replace(/[\s()-]/g, "");
}

/**
 * Fetch and validate the signed-in user's office authorization profile.
 * Requires an already verified Firebase Phone Auth user.
 * No profile is created or changed by this function.
 */
export async function getAuthorizedOfficeProfile(user = auth.currentUser) {
  if (!user || !user.uid || !user.phoneNumber) {
    throw new Error("A verified Firebase phone-auth session is required.");
  }

  const snap = await getDoc(doc(db, "office_staff_auth", user.uid));
  if (!snap.exists()) {
    throw new Error("This phone is not enrolled for UB AYURVED Office access. Contact the authorized administrator.");
  }

  const profile = snap.data();
  const role = String(profile.role || "").trim().toUpperCase();
  const expectedCategory = ROLE_CATEGORIES[role];

  if (profile.active !== true) throw new Error("This Office account is inactive.");
  if (profile.uid !== user.uid) throw new Error("Office account UID mismatch.");
  if (!expectedCategory || profile.category !== expectedCategory) {
    throw new Error("Office role/category is invalid. Contact the authorized administrator.");
  }
  if (normalizePhone(profile.phoneE164) !== normalizePhone(user.phoneNumber)) {
    throw new Error("Verified phone number does not match the enrolled Office profile.");
  }
  if (!String(profile.displayName || "").trim()) {
    throw new Error("Office profile is missing its display name.");
  }

  return Object.freeze({
    type: "OFFICE",
    uid: user.uid,
    phoneNumber: user.phoneNumber,
    role,
    category: expectedCategory,
    displayName: String(profile.displayName).trim(),
    hmCode: "",
    rankCode: "OFFICE",
    isSuperAdmin: role === "SUPER_ADMIN",
    canEditMedAndHm: role === "SUPER_ADMIN" ||
      role === "STAFF_SONALI" || role === "STAFF_KOUSHIK",
    canVerifyBilling: role === "SUPER_ADMIN" || role === "ADMIN_1" ||
      role === "STAFF_SONALI" || role === "STAFF_KOUSHIK",
    canConfirmDelivery: role === "SUPER_ADMIN" ||
      role === "STAFF_JEET"
  });
}
