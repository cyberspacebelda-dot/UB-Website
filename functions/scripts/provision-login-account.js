#!/usr/bin/env node
"use strict";

// Run from a trusted workstation after setting GOOGLE_APPLICATION_CREDENTIALS
// to a service-account key stored OUTSIDE this repository, or using ADC.
// This script never accepts credentials as command-line arguments and never logs them.

const readline = require("node:readline");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DATABASE_ID = "ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2";
const OFFICE = {
  "1": { loginId: "HQ-SUPER-ADMIN", role: "HQ_SUPER_ADMIN", displayName: "Belda HQ Super Admin" },
  "2": { loginId: "HQ-ADMIN", role: "HQ_ADMIN", displayName: "Belda HQ Admin" },
  "3": { loginId: "BILLING-SONALI", role: "BILLING_SONALI", displayName: "Sonali - Billing Staff" },
  "4": { loginId: "BILLING-KOUSHIK", role: "BILLING_KOUSHIK", displayName: "Koushik - Billing Staff" },
  "5": { loginId: "MEDICINE-INCHARGE-GOPAL", role: "MEDICINE_INCHARGE_GOPAL", displayName: "Gopal - Medicine Incharge" },
  "6": { loginId: "MEDICINE-INCHARGE-MILAN", role: "MEDICINE_INCHARGE_MILAN", displayName: "Milan - Medicine Incharge" },
  "7": { loginId: "MEDICINE-INCHARGE-JEET", role: "MEDICINE_INCHARGE_JEET", displayName: "Jeet - Medicine Incharge" }
};
const HM_RANKS = new Set(["HM_PR", "HM1", "HM2", "HM3"]);
const EXTRA_RANKS = new Set(["", "MR", "SR", "SE", "SO", "TSM", "ASM", "RSM"]);

function ask(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));
}
function askSecret(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this script in an interactive terminal."));
    const onData = chunk => {
      const value = chunk.toString("utf8");
      if (value === "\r" || value === "\n") {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(secret);
      } else if (value === "\u0003") {
        process.exit(130);
      } else if (value === "\u007f" || value === "\b") {
        secret = secret.slice(0, -1);
      } else if (value >= " " && value <= "~") {
        secret += value;
      }
    };
    let secret = "";
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
function normalizeLoginId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
}
async function main() {
  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();
  const db = getFirestore(undefined, DATABASE_ID);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\nUB Ayurved secure account provisioning");
    console.log("1. HQ Super Admin\n2. HQ Admin\n3. Sonali - Billing\n4. Koushik - Billing");
    console.log("5. Gopal - Medicine Incharge\n6. Milan - Medicine Incharge\n7. Jeet - Medicine Incharge\n8. Health Mitra");
    const choice = await ask(rl, "Select account type (1-8): ");
    let account;

    if (OFFICE[choice]) {
      account = { ...OFFICE[choice], accountType: "OFFICE" };
    } else if (choice === "8") {
      const hmCode = normalizeLoginId(await ask(rl, "Existing Health Mitra Code: "));
      if (!hmCode) throw new Error("HM Code is required.");
      const hmSnap = await db.collection("health_mitras").doc(hmCode).get();
      if (!hmSnap.exists) throw new Error("HM profile not found by document ID. No account was created.");
      const hm = hmSnap.data();
      const primaryRank = String(hm.rankCode || "HM1").trim().toUpperCase().replace(/[.-]/g, "_");
      const extraRank = String(hm.extraRank || "").trim().toUpperCase();
      if (!HM_RANKS.has(primaryRank) || !EXTRA_RANKS.has(extraRank)) {
        throw new Error("HM profile has an unsupported primary or extra rank. Correct and verify the profile first.");
      }
      account = {
        loginId: hmCode,
        role: "HEALTH_MITRA",
        accountType: "HM",
        displayName: String(hm.name || hmCode),
        hmCode,
        primaryRank,
        extraRank
      };
    } else {
      throw new Error("Invalid selection.");
    }

    const loginId = normalizeLoginId(account.loginId);
    const accountRef = db.collection("login_accounts").doc(loginId);
    const existing = await accountRef.get();
    if (existing.exists) throw new Error("Account already exists. This utility will not overwrite it.");

    const pin = await askSecret("Enter a new PIN (minimum 8 characters): ");
    if (pin.length < 8 || pin.length > 128) throw new Error("PIN must contain 8 to 128 characters.");
    const confirm = await askSecret("Confirm new PIN: ");
    if (pin !== confirm) throw new Error("PIN confirmation did not match.");

    const uid = "ub_" + crypto.createHash("sha256").update(loginId).digest("hex").slice(0, 28);
    const salt = await bcrypt.genSalt(12);
    const pinHash = await bcrypt.hash(pin, salt);

    await auth.createUser({ uid, displayName: account.displayName, disabled: false });
    try {
      await accountRef.create({
        uid,
        role: account.role,
        accountType: account.accountType,
        displayName: account.displayName,
        pinSalt: salt,
        pinHash,
        isActive: true,
        ...(account.accountType === "HM" ? {
          hmCode: account.hmCode,
          primaryRank: account.primaryRank,
          extraRank: account.extraRank
        } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      await auth.deleteUser(uid).catch(() => {});
      throw error;
    }

    console.log("Account provisioned successfully:", loginId, "Role:", account.role);
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error("Provisioning failed:", error.message);
  process.exitCode = 1;
});
