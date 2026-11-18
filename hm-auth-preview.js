import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendEmailVerification, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Same Firebase project and named database as the Android app.
// This preview intentionally accesses only Firebase Auth and the UID-keyed request path.
const firebaseConfig = {
  apiKey: "AIzaSyCeBji4psN338W78IMs1JSlWZpPEnCbCh4",
  authDomain: "ub-ayurved.firebaseapp.com",
  projectId: "ub-ayurved",
  storageBucket: "ub-ayurved.firebasestorage.app",
  messagingSenderId: "893264713046",
  appId: "1:893264713046:android:8964bf3f130a0b90cff2f7"
};
const app = initializeApp(firebaseConfig, "hm-auth-preview");
const auth = getAuth(app);
const db = getFirestore(app, "ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2");
const googleProvider = new GoogleAuthProvider();

const $ = id => document.getElementById(id);
const notice = $("notice");
function show(message, kind = "info") {
  notice.textContent = message;
  notice.className = "mb-4 rounded-xl border p-3 text-sm " +
    (kind === "error" ? "border-red-200 bg-red-50 text-red-800" :
     kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
     "border-blue-200 bg-blue-50 text-blue-900");
}
function setBusy(busy) {
  ["googleBtn", "signInBtn", "signUpBtn", "submitRequestBtn"].forEach(id => {
    const el = $(id); if (el) el.disabled = busy || (id === "submitRequestBtn" && !auth.currentUser?.emailVerified);
  });
}
async function withErrorHandling(action) {
  setBusy(true);
  try { await action(); }
  catch (error) { show(error?.message || "Authentication failed. Please try again.", "error"); }
  finally { setBusy(false); }
}

$("googleBtn").addEventListener("click", () => withErrorHandling(async () => {
  await signInWithPopup(auth, googleProvider);
}));
$("signInBtn").addEventListener("click", () => withErrorHandling(async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) throw new Error("Enter email and password.");
  await signInWithEmailAndPassword(auth, email, password);
}));
$("signUpBtn").addEventListener("click", () => withErrorHandling(async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || password.length < 8) throw new Error("Enter a valid email and a password of at least 8 characters.");
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
  show("Verification email sent. Verify your email, then sign in again to submit your request.", "success");
  await signOut(auth);
}));
$("signOutBtn").addEventListener("click", () => withErrorHandling(() => signOut(auth)));

onAuthStateChanged(auth, user => {
  $("authPanel").classList.toggle("hidden", Boolean(user));
  $("requestPanel").classList.toggle("hidden", !user);
  if (!user) return;
  $("signedInEmail").textContent = user.email || "Google account";
  const verified = Boolean(user.emailVerified);
  $("verificationNotice").textContent = verified
    ? "Email verified. You may submit your registration request."
    : "Email not verified. Please sign out, verify the link sent to your email, then sign in again.";
  $("submitRequestBtn").disabled = !verified;
  if (!verified && user.providerData.some(p => p.providerId === "google.com")) {
    $("verificationNotice").textContent = "Google account detected. Firebase reports email verification: " + (verified ? "verified" : "not verified") + ".";
  }
});

$("requestForm").addEventListener("submit", event => {
  event.preventDefault();
  withErrorHandling(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in first.");
    await user.reload();
    if (!user.emailVerified) throw new Error("Verify your email before submitting a request.");
    const fullName = $("fullName").value.trim();
    const mobile = $("mobile").value.trim();
    const address = $("address").value.trim();
    const sponsorReference = $("sponsor").value.trim();
    if (!fullName || !mobile || !address) throw new Error("Name, mobile and address are required.");
    // No HM code, rank, role, approval flag, password or business data is accepted from the applicant.
    await setDoc(doc(db, "hm_registration_requests", user.uid), {
      uid: user.uid,
      email: user.email || "",
      fullName,
      mobile,
      address,
      sponsorReference,
      status: "PENDING",
      createdAt: serverTimestamp()
    });
    show("Request submitted. Your account remains pending until an authorised Super Admin approves it.", "success");
    $("submitRequestBtn").disabled = true;
  });
});
