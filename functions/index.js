const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const bcrypt = require("bcryptjs");

initializeApp();
const db = getFirestore(getApp(), "ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2");

const ALLOWED_ROLES = new Set([
  "HQ_SUPER_ADMIN",
  "HQ_ADMIN",
  "BILLING_SONALI",
  "BILLING_KOUSHIK",
  "MEDICINE_INCHARGE_GOPAL",
  "MEDICINE_INCHARGE_MILAN",
  "MEDICINE_INCHARGE_JEET",
  "HEALTH_MITRA"
]);

const GENERIC_LOGIN_ERROR = "Invalid login details or account is inactive.";

function normalizeLoginId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
}

function safeRoleClaims(account) {
  const role = String(account.role || "").trim().toUpperCase();
  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpsError("permission-denied", GENERIC_LOGIN_ERROR);
  }

  const accountType = String(account.accountType || "OFFICE").toUpperCase();
  if ((role === "HEALTH_MITRA") !== (accountType === "HM")) {
    throw new HttpsError("permission-denied", GENERIC_LOGIN_ERROR);
  }
  if (accountType !== "HM" && accountType !== "OFFICE") {
    throw new HttpsError("permission-denied", GENERIC_LOGIN_ERROR);
  }

  const claims = {
    role,
    accountType,
    canManageRawMaterial: [
      "HQ_SUPER_ADMIN", "HQ_ADMIN",
      "MEDICINE_INCHARGE_GOPAL", "MEDICINE_INCHARGE_MILAN", "MEDICINE_INCHARGE_JEET"
    ].includes(role),
    canManageReadyMedicine: [
      "HQ_SUPER_ADMIN", "HQ_ADMIN",
      "MEDICINE_INCHARGE_GOPAL", "MEDICINE_INCHARGE_MILAN", "MEDICINE_INCHARGE_JEET"
    ].includes(role),
    canBilling: ["HQ_SUPER_ADMIN", "HQ_ADMIN", "BILLING_SONALI", "BILLING_KOUSHIK"].includes(role)
  };

  if (accountType === "HM") {
    claims.hmCode = String(account.hmCode || account.uid || "").toUpperCase();
    claims.primaryRank = String(account.primaryRank || "HM1").toUpperCase();
    claims.extraRank = String(account.extraRank || "").toUpperCase();
  }
  return claims;
}

exports.loginWithPin = onCall(
  {
    region: "asia-south1",
    enforceAppCheck: false,
    maxInstances: 10
  },
  async (request) => {
    const loginId = normalizeLoginId(request.data?.loginId);
    const pin = String(request.data?.pin || "");

    if (!loginId || pin.length < 4 || pin.length > 128) {
      throw new HttpsError("invalid-argument", GENERIC_LOGIN_ERROR);
    }

    const accountRef = db.collection("login_accounts").doc(loginId);
    const rateRef = db.collection("_auth_rate_limits").doc(
      Buffer.from(loginId).toString("base64url").slice(0, 100)
    );

    const now = Timestamp.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 8;

    const rate = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const data = snap.exists ? snap.data() : {};
      const startedAt = data.windowStartedAt?.toMillis?.() || 0;
      const attempts = startedAt && now.toMillis() - startedAt < windowMs
        ? Number(data.attempts || 0)
        : 0;

      if (attempts >= maxAttempts) return { blocked: true };

      tx.set(rateRef, {
        attempts: attempts + 1,
        windowStartedAt: attempts === 0 ? now : data.windowStartedAt || now,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return { blocked: false };
    });

    if (rate.blocked) {
      throw new HttpsError("resource-exhausted", "Too many attempts. Try again after 15 minutes.");
    }

    const accountSnap = await accountRef.get();
    if (!accountSnap.exists) {
      throw new HttpsError("unauthenticated", GENERIC_LOGIN_ERROR);
    }

    const account = accountSnap.data();
    if (account.isActive !== true || typeof account.pinHash !== "string" ||
        typeof account.pinSalt !== "string" || !account.uid) {
      throw new HttpsError("unauthenticated", GENERIC_LOGIN_ERROR);
    }

    const candidateHash = await bcrypt.hash(pin, account.pinSalt);
    const valid = candidateHash.length === account.pinHash.length &&
      require("crypto").timingSafeEqual(
        Buffer.from(candidateHash, "utf8"),
        Buffer.from(account.pinHash, "utf8")
      );

    if (!valid) {
      throw new HttpsError("unauthenticated", GENERIC_LOGIN_ERROR);
    }

    const claims = safeRoleClaims(account);
    const customToken = await getAuth().createCustomToken(String(account.uid), claims);

    await rateRef.set({
      attempts: 0,
      windowStartedAt: now,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      token: customToken,
      uid: String(account.uid),
      role: claims.role,
      accountType: claims.accountType,
      displayName: String(account.displayName || "")
    };
  }
);
