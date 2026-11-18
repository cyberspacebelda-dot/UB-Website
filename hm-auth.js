import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const config = {
  apiKey: "AIzaSyCeBji4psN338W78IMs1JSlWZpPEnCbCh4",
  authDomain: "ub-ayurved.firebaseapp.com",
  projectId: "ub-ayurved",
  storageBucket: "ub-ayurved.firebasestorage.app",
  messagingSenderId: "893264713046",
  appId: "1:893264713046:android:8964bf3f130a0b90cff2f7"
};
const app = getApps().length ? getApp() : initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
let verifier = null, confirmation = null, mode = "login";
const $ = id => document.getElementById(id);
const say = msg => { $("message").textContent = msg; };

function e164(value) {
  const v = String(value || "").replace(/[\s()-]/g, "");
  if (/^\d{10}$/.test(v)) return "+91" + v;
  if (/^\+91\d{10}$/.test(v)) return v;
  throw new Error("Enter a valid 10-digit Indian mobile number or +91 number.");
}
function setupRecaptcha() {
  if (verifier) verifier.clear();
  verifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "normal" });
  return verifier.render();
}
$("loginTab").onclick = () => switchMode("login");
$("registerTab").onclick = () => switchMode("register");
function switchMode(next) {
  mode = next;
  $("loginPanel").classList.toggle("hidden", mode !== "login");
  $("registerPanel").classList.toggle("hidden", mode !== "register");
  $("loginTab").className = "flex-1 rounded-xl p-2 font-bold " + (mode === "login" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100");
  $("registerTab").className = "flex-1 rounded-xl p-2 font-bold " + (mode === "register" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100");
  $("otpPanel").classList.add("hidden");
  $("recaptcha-container").innerHTML = "";
  verifier = null; confirmation = null;
}
$("sendOtp").onclick = async () => {
  try {
    const phone = e164(mode === "login" ? $("loginPhone").value : $("regPhone").value);
    if (mode === "register") {
      if ($("regName").value.trim().length < 2) throw new Error("Enter your full name.");
    }
    $("sendOtp").disabled = true;
    await setupRecaptcha();
    confirmation = await signInWithPhoneNumber(auth, phone, verifier);
    $("otpPanel").classList.remove("hidden");
    say("OTP sent. Complete phone verification to continue.");
  } catch (e) {
    say(e.message || "Could not send OTP.");
  } finally { $("sendOtp").disabled = false; }
};
$("verifyOtp").onclick = async () => {
  try {
    if (!confirmation) throw new Error("Request an OTP first.");
    const code = $("otpCode").value.trim();
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit OTP.");
    const result = await confirmation.confirm(code);
    confirmation = null;
    if (mode === "register") await submitRegistration(result.user);
    else await loadHmStatus(result.user);
  } catch (e) { say(e.message || "OTP verification failed."); }
};
async function submitRegistration(user) {
  const phone = user.phoneNumber;
  if (!phone) throw new Error("Firebase did not return a verified phone number.");
  const uid = user.uid;
  const payload = {
    uid, phoneE164: phone, name: $("regName").value.trim(),
    mobileNo: phone, hmAddress: $("regAddress").value.trim(),
    sponsorHmId: $("regSponsor").value.trim().toUpperCase(),
    rankCode: $("regRank").value, status: "PENDING",
    createdAt: serverTimestamp()
  };
  await setDoc(doc(db, "hm_registration_requests", uid), payload);
  await loadHmStatus(user);
}
async function loadHmStatus(user) {
  $("authCard").classList.add("hidden");
  $("hmStatus").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  const profile = await getDoc(doc(db, "hm_auth_profiles", user.uid));
  if (profile.exists()) {
    const p = profile.data();
    $("hmStatusText").textContent = "Approved • HM Code: " + p.hmCode + " • " + p.name + ". Your verified account is active.";
    return;
  }
  const request = await getDoc(doc(db, "hm_registration_requests", user.uid));
  if (request.exists()) {
    const r = request.data();
    $("hmStatusText").textContent = r.status === "REJECTED"
      ? "Your registration was not approved. Please contact the office."
      : "Registration received for " + r.name + ". Status: PENDING. You can use the portal after Super Admin approval.";
  } else {
    $("hmStatusText").textContent = "This phone number is not linked to an approved Health Mitra profile. Please submit a new registration request.";
    $("authCard").classList.remove("hidden");
  }
}
async function loadAdminPanel(user) {
  const profile = await getDoc(doc(db, "office_staff_auth", user.uid));
  if (!profile.exists()) return;
  const p = profile.data();
  if (p.active !== true || p.uid !== user.uid || p.phoneE164 !== user.phoneNumber ||
      p.staffRole !== "SUPER_ADMIN" || p.officeCategory !== "SUPER_ADMIN") return;
  $("adminPanel").classList.remove("hidden");
  await refreshPending();
}
async function refreshPending() {
  const q = query(collection(db, "hm_registration_requests"), where("status", "==", "PENDING"));
  const snap = await getDocs(q);
  $("pendingList").innerHTML = "";
  if (snap.empty) { $("pendingList").textContent = "No pending registrations."; return; }
  snap.forEach(item => {
    const r = item.data();
    const row = document.createElement("div");
    row.className = "border rounded-xl p-3 space-y-2";
    const title = document.createElement("div");
    title.className = "font-bold";
    title.textContent = r.name + " • " + r.phoneE164 + " • " + r.rankCode;
    const detail = document.createElement("div");
    detail.textContent = "Address: " + r.hmAddress + " | Sponsor: " + (r.sponsorHmId || "—");
    const code = document.createElement("input");
    code.placeholder = "Assign HM Code (e.g. HM001)";
    code.className = "w-full border rounded-lg p-2";
    code.maxLength = 14;
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.className = "bg-emerald-700 text-white rounded-lg px-4 py-2 font-bold mr-2";
    approve.onclick = async () => {
      try {
        const hmCode = code.value.trim().toUpperCase();
        if (!/^HM[A-Z0-9]{3,12}$/.test(hmCode)) throw new Error("Enter an HM Code such as HM001.");
        const uid = item.id;
        const profile = {
          uid, phoneE164: r.phoneE164, hmCode, name: r.name,
          mobileNo: r.mobileNo, hmAddress: r.hmAddress,
          sponsorHmId: r.sponsorHmId, rankCode: r.rankCode,
          status: "APPROVED", active: true,
          createdAt: r.createdAt, approvedAt: serverTimestamp()
        };
        await setDoc(doc(db, "hm_auth_profiles", uid), profile);
        await updateDoc(doc(db, "hm_registration_requests", uid), {
          status: "APPROVED", hmCode, reviewedAt: serverTimestamp(),
          reviewedBy: p.displayName
        });
        say("Approved " + r.name + ".");
        await refreshPending();
      } catch (e) { say(e.message || "Approval failed."); }
    };
    const reject = document.createElement("button");
    reject.textContent = "Reject";
    reject.className = "bg-rose-100 text-rose-800 rounded-lg px-4 py-2 font-bold";
    reject.onclick = async () => {
      try {
        await updateDoc(doc(db, "hm_registration_requests", item.id), {
          status: "REJECTED", reviewedAt: serverTimestamp(), reviewedBy: p.displayName
        });
        await refreshPending();
      } catch (e) { say(e.message || "Rejection failed."); }
    };
    row.append(title, detail, code, approve, reject);
    $("pendingList").append(row);
  });
}
$("adminRefresh").onclick = () => refreshPending().catch(e => say(e.message));
$("logout").onclick = async () => {
  await signOut(auth);
  location.reload();
};
onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    await loadHmStatus(user);
    await loadAdminPanel(user);
  } catch (e) {
    say(e.message || "Could not load account.");
  }
});
