import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// Reuses the same Firebase app instance/configuration as app.js.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCeBji4psN338W78IMs1JSlWZpPEnCbCh4",
  authDomain: "ub-ayurved.firebaseapp.com",
  projectId: "ub-ayurved",
  storageBucket: "ub-ayurved.firebasestorage.app",
  messagingSenderId: "893264713046",
  appId: "1:893264713046:android:8964bf3f130a0b90cff2f7"
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

let verifier = null;
let confirmation = null;

/**
 * Create/recreate an invisible or visible reCAPTCHA verifier.
 * The target element must exist in the page before this is called.
 */
export function createPhoneRecaptcha(containerId, size = "normal") {
  if (verifier) {
    try {
      verifier.clear();
    } catch (_) {
      // A stale verifier may already have been cleared by the SDK.
    }
  }
  verifier = new RecaptchaVerifier(auth, containerId, { size });
  return verifier.render();
}

/**
 * Send OTP to an E.164 formatted number, e.g. +919876543210.
 * Does not create or modify Firestore profile documents.
 */
export async function sendPhoneOtp(phoneE164) {
  const phone = String(phoneE164 || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Enter a valid phone number in international format (e.g. +919876543210).");
  }
  if (!verifier) {
    throw new Error("Phone verification is not initialized. Complete the reCAPTCHA first.");
  }
  confirmation = await signInWithPhoneNumber(auth, phone, verifier);
  return true;
}

/**
 * Confirm the latest OTP. Returns Firebase User after successful verification.
 */
export async function confirmPhoneOtp(code) {
  const otp = String(code || "").trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new Error("Enter the 6-digit OTP.");
  }
  if (!confirmation) {
    throw new Error("Request an OTP before entering the code.");
  }
  const result = await confirmation.confirm(otp);
  confirmation = null;
  return result.user;
}

export function observeFirebaseAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signOutFirebase() {
  confirmation = null;
  await signOut(auth);
}

export function clearPhoneRecaptcha() {
  if (verifier) {
    try {
      verifier.clear();
    } finally {
      verifier = null;
    }
  }
  confirmation = null;
}
