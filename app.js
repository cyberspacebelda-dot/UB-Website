import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  createPhoneRecaptcha, sendPhoneOtp, confirmPhoneOtp,
  clearPhoneRecaptcha, observeFirebaseAuth, signOutFirebase
} from "./firebase-auth.js";
import { getAuthorizedOfficeProfile } from "./office-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ============================================================================
// 1. EXACT SAME FIREBASE & FIRESTORE DATABASE CONFIGURATION AS ANDROID APP
// ============================================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCeBji4psN338W78IMs1JSlWZpPEnCbCh4",
  authDomain: "ub-ayurved.firebaseapp.com",
  projectId: "ub-ayurved",
  storageBucket: "ub-ayurved.firebasestorage.app",
  messagingSenderId: "893264713046",
  appId: "1:893264713046:android:8964bf3f130a0b90cff2f7"
};
const FIRESTORE_DATABASE_ID = "ai-studio-android-stockpul-5036268a-3e2b-45b8-b9d9-792b6c85c0b2";

const firebaseApp = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
// Fail closed if the named Android-shared database cannot be opened.
// Never silently fall back to the default Firestore database.
const db = getFirestore(firebaseApp, FIRESTORE_DATABASE_ID);

// ============================================================================
// 2. ROLES, RANKS & PERMISSION HIERARCHY (IDENTICAL TO ANDROID APP)
// ============================================================================
const MEMBER_RANK_OPTIONS = [
  { code: "MR", title: "Medical Representative", isHmTier: false, badgeHint: "Upline Rank" },
  { code: "HM1", title: "Health Mitra Tier 1", isHmTier: true, badgeHint: "Under MR • Sees All 3 HM Prices" },
  { code: "HM2", title: "Health Mitra Tier 2", isHmTier: true, badgeHint: "Under MR • HM2 Price Only" },
  { code: "HM3", title: "Health Mitra Tier 3", isHmTier: true, badgeHint: "Under MR • HM3 Price Only" },
  { code: "SR", title: "Senior Representative", isHmTier: false, badgeHint: "Rank Holder" },
  { code: "SE", title: "Sales Executive", isHmTier: false, badgeHint: "Rank Holder" },
  { code: "SO", title: "Sales Officer", isHmTier: false, badgeHint: "Rank Holder" },
  { code: "TSM", title: "Territory Sales Manager", isHmTier: false, badgeHint: "Rank Holder" },
  { code: "ASM", title: "Area Sales Manager", isHmTier: false, badgeHint: "Rank Holder" },
  { code: "RSM", title: "Regional Sales Manager", isHmTier: false, badgeHint: "Rank Holder" }
];

const PROMOTION_LADDER = ["HM1", "HM2", "HM3", "MR", "SR", "SE", "SO", "TSM", "ASM", "RSM"];

function normalizeRankCode(rawCode) {
  const clean = String(rawCode || "").trim().toUpperCase();
  if (!clean || clean === "HM" || clean === "HM-1" || clean === "HM_1") return "HM1";
  if (clean === "HM-2" || clean === "HM_2") return "HM2";
  if (clean === "HM-3" || clean === "HM_3") return "HM3";
  return clean;
}

function getRankTitle(rawCode) {
  const norm = normalizeRankCode(rawCode);
  const found = MEMBER_RANK_OPTIONS.find(r => r.code === norm);
  return found ? found.title : "Health Mitra Tier 1";
}

function isHmSelfTier(rawCode) {
  const norm = normalizeRankCode(rawCode);
  return norm === "HM1" || norm === "HM2" || norm === "HM3" || norm === "HM";
}

function deriveCodeName(name) {
  const cleaned = String(name || "").trim();
  const beforeParen = cleaned.split("(")[0].trim();
  const token = (beforeParen.split(" ")[0] || "").trim();
  return (token.length >= 2 ? beforeParen : cleaned).slice(0, 18);
}

function inferCategory(name, pack) {
  const uName = String(name || "").toUpperCase();
  const uPack = String(pack || "").toUpperCase();
  if (uName.includes("OIL") || uName.includes("TAIL")) return "Oils";
  if (uName.includes("SYRUP") || uName.includes("TONIC") || uName.includes("KWATH") || uName.includes("DROP") || uName.includes("KADHA") || uPack.includes("ML")) return "Syrups & Liquids";
  if (uName.includes("CHURNA") || uName.includes("TOOTHPAST") || uPack.includes("GM")) return "Powders & Care";
  if (uPack.includes("CAP")) return "Capsules";
  if (uPack.includes("TAB")) return "Tablets";
  return "Ayurvedic Formulations";
}

// ============================================================================
// 3. REAL-TIME STATE STORE
// ============================================================================
const state = {
  currentUser: null, // { type: 'OFFICE'|'HM', role, displayName, hmCode, isSuperAdmin, canEditMedAndHm, canConfirmDelivery }
  activeTab: "PRICE_LIST",
  healthMitras: [],
  bills: [],
  returns: [],
  ledger: [],
  firestoreMedicines: [],
  medicineOverrides: {}, // id -> TieredMedicineEntry
  incentiveSettings: {
    hmManualPct: 5.0,
    rankSelfPctMap: { HM: 5, MR: 8, SR: 11, SE: 14, SO: 17, TSM: 20, ASM: 23, RSM: 26 },
    rankTeamPctMap: { HM: 0, MR: 3, SR: 6, SE: 9, SO: 12, TSM: 15, ASM: 18, RSM: 21 },
    memberOverrides: {}
  },
  // UI filter state
  priceSearch: "",
  priceCategory: "ALL",
  hmSearch: "",
  ordersSearch: "",
  treeRootHmCode: "",
  // New Bill state
  billSelectedHmCode: "",
  billMode: "DISPENSARY_CHALLAN", // DISPENSARY_CHALLAN | WITH_RETAIL_PROFIT
  billPaymentMode: "CASH", // CASH | ONLINE | CREDIT
  billOnlineAmount: "",
  billOnlineDate: new Date().toISOString().slice(0, 10),
  billOnlineTime: new Date().toTimeString().slice(0, 5),
  billItems: [], // { medicineId, slNo, medicineName, codeName, quantityNetContent, unitPrice, mrp, quantity, totalAmount }
  billMedSearch: ""
};

// Build base 273 catalog map
const BASE_CATALOG_2026 = (window.FINAL_PRICE_LIST_2026 || []).map(row => {
  const [slNo, name, quantityNetContent, mrpPrice, hm1Price, hm2Price, hm3Price, patientPrice] = row;
  return {
    id: `med_${slNo}`,
    slNo,
    name,
    codeName: deriveCodeName(name),
    quantityNetContent,
    mrpPrice: Number(mrpPrice),
    hm1Price: Number(hm1Price),
    hm2Price: Number(hm2Price),
    hm3Price: Number(hm3Price),
    patientPrice: Number(patientPrice),
    category: inferCategory(name, quantityNetContent),
    stockQuantity: 0
  };
});

function getMergedMedicines() {
  const fsById = {};
  const fsBySlNo = {};
  for (const m of state.firestoreMedicines) {
    if (m.id) fsById[String(m.id).toLowerCase()] = m;
    if (m.slNo > 0) fsBySlNo[m.slNo] = m;
  }

  const result = [];
  const seenIds = new Set();

  for (const cat of BASE_CATALOG_2026) {
    const idKey = cat.id.toLowerCase();
    const ov = state.medicineOverrides[idKey] || Object.values(state.medicineOverrides).find(x => x.slNo === cat.slNo);
    const fsMed = fsBySlNo[cat.slNo] || fsById[idKey];
    const src = ov || cat;
    const stock = ov?.stockQuantity !== undefined ? Number(ov.stockQuantity) : Number(fsMed?.stockQuantity || 0);
    const merged = {
      id: src.id || cat.id,
      slNo: Number(src.slNo || cat.slNo),
      name: src.name || cat.name,
      codeName: src.codeName || deriveCodeName(src.name || cat.name),
      quantityNetContent: src.quantityNetContent || cat.quantityNetContent,
      mrpPrice: Number(src.mrpPrice ?? cat.mrpPrice),
      hm1Price: Number(src.hm1Price ?? cat.hm1Price),
      hm2Price: Number(src.hm2Price ?? cat.hm2Price),
      hm3Price: Number(src.hm3Price ?? cat.hm3Price),
      patientPrice: Number(src.patientPrice ?? cat.patientPrice),
      category: src.category || cat.category,
      stockQuantity: stock
    };
    seenIds.add(merged.id.toLowerCase());
    result.push(merged);
  }

  for (const ov of Object.values(state.medicineOverrides)) {
    const idKey = String(ov.id || `med_${ov.slNo}`).toLowerCase();
    if (!seenIds.has(idKey)) {
      seenIds.add(idKey);
      result.push({
        id: ov.id || `med_${ov.slNo}`,
        slNo: Number(ov.slNo || 999),
        name: ov.name || "",
        codeName: ov.codeName || deriveCodeName(ov.name || ""),
        quantityNetContent: ov.quantityNetContent || "",
        mrpPrice: Number(ov.mrpPrice || 0),
        hm1Price: Number(ov.hm1Price || 0),
        hm2Price: Number(ov.hm2Price || 0),
        hm3Price: Number(ov.hm3Price || 0),
        patientPrice: Number(ov.patientPrice || 0),
        category: ov.category || inferCategory(ov.name, ov.quantityNetContent),
        stockQuantity: Number(ov.stockQuantity || 0)
      });
    }
  }

  return result.sort((a, b) => a.slNo - b.slNo);
}

// ============================================================================
// 4. VISIBILITY & PRICE TIER RESOLUTION (IDENTICAL TO ANDROID APP)
// ============================================================================
function getLoggedInHmObject() {
  if (!state.currentUser || state.currentUser.type !== "HM") return null;
  return state.healthMitras.find(
    h => String(h.hmCode || "").toUpperCase() === String(state.currentUser.hmCode || "").toUpperCase()
  ) || null;
}

function getVisibleHmTierMode() {
  if (!state.currentUser) return "ALL_THREE";
  if (state.currentUser.type === "OFFICE") return "ALL_THREE";
  const hm = getLoggedInHmObject();
  const rank = normalizeRankCode(hm?.rankCode || state.currentUser.rankCode || "HM1");
  if (rank === "HM2") return "ONLY_HM2";
  if (rank === "HM3") return "ONLY_HM3";
  return "ALL_THREE"; // HM1 and MR..RSM see all 3 HM prices
}

function getPriceForHmRank(med, rankCode) {
  const norm = normalizeRankCode(rankCode);
  if (norm === "HM2") return med.hm2Price;
  if (norm === "HM3") return med.hm3Price;
  return med.hm1Price;
}

// ============================================================================
// 5. START REAL-TIME FIRESTORE LISTENERS
// ============================================================================
function initFirestoreListeners() {
  const listen = (...args) => officeUnsubscribers.push(onSnapshot(...args));
  // 1. Health Mitras
  // Intentionally do not read health_mitras yet: legacy documents contain
  // plaintext passwords. Re-enable only after server-side credential migration
  // and UID-scoped HM profile rules are complete.


  // 2. Bills / Challans
  listen(collection(db, "bills"), snap => {
    const list = [];
    snap.forEach(d => {
      const data = d.data();
      const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : (data.verifiedAt || Date.now());
      list.push({
        id: d.id,
        billNumber: data.billNumber || d.id,
        hmCode: data.hmCode || "",
        hmName: data.hmName || "",
        hmMobile: data.hmMobile || "",
        hmAddress: data.hmAddress || "",
        gpName: data.gpName || "",
        pincode: data.pincode || "",
        branch: data.branch || "Belda HQ",
        patientName: data.patientName || "",
        patientMobile: data.patientMobile || "",
        billingMode: data.billingMode || "DISPENSARY_CHALLAN",
        paymentMode: data.paymentMode || "CASH",
        items: Array.isArray(data.items) ? data.items : [],
        subtotal: Number(data.subtotal || 0),
        discount: Number(data.discount || 0),
        netAmount: Number(data.netAmount || data.subtotal || 0),
        previousBalance: Number(data.previousBalance || 0),
        currentBalance: Number(data.currentBalance || 0),
        isChallanOnly: Boolean(data.isChallanOnly),
        status: data.status || "PENDING",
        verifiedBy: data.verifiedBy || "",
        verifiedAt: Number(data.verifiedAt || 0),
        deliveredBy: data.deliveredBy || "",
        deliveredAt: Number(data.deliveredAt || 0),
        stockDeducted: Boolean(data.stockDeducted),
        notes: data.notes || "",
        createdAtMs
      });
    });
    state.bills = list.sort((a, b) => b.createdAtMs - a.createdAtMs);
    renderDashboard();
  });

  // 3. Medicines (stock & base entries)
  listen(collection(db, "medicines"), snap => {
    const list = [];
    snap.forEach(d => {
      const data = d.data();
      list.push({ id: d.id, ...data });
    });
    state.firestoreMedicines = list;
    renderDashboard();
  });

  // 4. Medicine Price List 2026 Tier Overrides (commission_config/medicine_price_list_2026)
  listen(doc(db, "commission_config", "medicine_price_list_2026"), snap => {
    if (snap.exists()) {
      const raw = snap.data()?.jsonPayload;
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          const map = {};
          for (const item of arr) {
            if (item && item.id) {
              map[String(item.id).toLowerCase()] = item;
            }
          }
          state.medicineOverrides = map;
          renderDashboard();
        } catch (e) {
          console.warn("Error parsing medicine_price_list_2026:", e);
        }
      }
    }
  });

  // 5. Incentive Rules V2: Super Admin only.
  if (state.currentUser?.isSuperAdmin) {
  listen(doc(db, "commission_config", "incentive_rules_v2"), snap => {
    if (snap.exists()) {
      const raw = snap.data()?.jsonPayload;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          state.incentiveSettings = {
            hmManualPct: Number(parsed.hmManualPct ?? 5.0),
            rankSelfPctMap: { HM: 5, MR: 8, SR: 11, SE: 14, SO: 17, TSM: 20, ASM: 23, RSM: 26, ...(parsed.rankSelfPctMap || {}) },
            rankTeamPctMap: { HM: 0, MR: 3, SR: 6, SE: 9, SO: 12, TSM: 15, ASM: 18, RSM: 21, ...(parsed.rankTeamPctMap || {}) },
            memberOverrides: parsed.memberOverrides || {}
          };
          renderDashboard();
        } catch (e) {
          console.warn("Error parsing incentive_rules_v2:", e);
        }
      }
    }
  });
  }

  // 6. Ledger: Super Admin and Billing Staff only.
  if (state.currentUser?.isSuperAdmin || ["STAFF_SONALI", "STAFF_KOUSHIK"].includes(state.currentUser?.role)) {
  listen(collection(db, "ledger"), snap => {
    const list = [];
    snap.forEach(d => {
      const data = d.data();
      const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
      list.push({ id: d.id, ...data, createdAtMs });
    });
    state.ledger = list.sort((a, b) => b.createdAtMs - a.createdAtMs);
    renderDashboard();
  });
  }
}

// ============================================================================
// 6. AUTHENTICATION & SESSION HANDLERS
// ============================================================================
function showToast(msg) {
  const el = document.getElementById("toastBox");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

let officeRecaptchaReady = false;
let officeListenersStarted = false;
let officeUnsubscribers = [];

function showLoginError(message) {
  const el = document.getElementById("officeLoginError");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

async function sendOfficeOtp() {
  const phone = document.getElementById("officePhoneInput")?.value.trim() || "";
  const sendButton = document.getElementById("sendOfficeOtpButton");
  try {
    if (!officeRecaptchaReady) {
      await createPhoneRecaptcha("officeRecaptchaContainer", "normal");
      officeRecaptchaReady = true;
    }
    await sendPhoneOtp(phone);
    document.getElementById("officeOtpSection")?.classList.remove("hidden");
    document.getElementById("officeLoginError")?.classList.add("hidden");
    showToast("OTP sent. Check your registered phone.");
  } catch (error) {
    clearPhoneRecaptcha();
    officeRecaptchaReady = false;
    showLoginError(error?.message || "Could not send OTP. Please try again.");
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}

async function verifyOfficeOtp() {
  const code = document.getElementById("officeOtpInput")?.value.trim() || "";
  const verifyButton = document.getElementById("verifyOfficeOtpButton");
  try {
    if (verifyButton) verifyButton.disabled = true;
    await confirmPhoneOtp(code);
    showToast("Phone verified. Checking your Office authorization...");
  } catch (error) {
    showLoginError(error?.message || "OTP verification failed.");
  } finally {
    if (verifyButton) verifyButton.disabled = false;
  }
}

async function applyAuthorizedOfficeUser(user) {
  const profile = await getAuthorizedOfficeProfile(user);
  state.currentUser = {
    type: "OFFICE", uid: profile.uid, role: profile.role,
    category: profile.category, displayName: profile.displayName,
    hmCode: "", rankCode: "OFFICE",
    isSuperAdmin: profile.isSuperAdmin,
    isReadOnlyAdmin: profile.isReadOnlyAdmin,
    canEditMedAndHm: profile.canEditMedAndHm,
    canVerifyBilling: profile.canVerifyBilling,
    canConfirmDelivery: profile.canConfirmDelivery
  };
  state.activeTab = "PRICE_LIST";
  if (!officeListenersStarted) {
    initFirestoreListeners();
    officeListenersStarted = true;
  }
  document.getElementById("officeLoginError")?.classList.add("hidden");
  enterDashboard();
}

async function loginHm() {
  const el = document.getElementById("hmLoginError");
  if (el) {
    el.textContent = "Health Mitra OTP login is being migrated. HM access will be enabled after secure Firebase account linking.";
    el.classList.remove("hidden");
  }
}

async function logout() {
  officeUnsubscribers.forEach(unsubscribe => {
    try { unsubscribe(); } catch (_) {}
  });
  officeUnsubscribers = [];
  officeListenersStarted = false;
  state.healthMitras = [];
  state.bills = [];
  state.returns = [];
  state.ledger = [];
  state.firestoreMedicines = [];
  state.medicineOverrides = {};
  try { await signOutFirebase(); }
  catch (error) { showToast(error?.message || "Sign-out failed."); }
  state.currentUser = null;
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("headerUserControls").classList.add("hidden");
  document.getElementById("headerUserControls").classList.remove("flex");
  document.getElementById("loginView").classList.remove("hidden");
}

function enterDashboard() {
  if (!state.currentUser) return;
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("dashboardView").classList.remove("hidden");
  const hc = document.getElementById("headerUserControls");
  hc.classList.remove("hidden");
  hc.classList.add("flex");
  renderDashboard();
}

// ============================================================================
// 7. DASHBOARD RENDERING (OFFICE vs HM STRICT SEPARATION)
// ============================================================================
function getTabsForCurrentUser() {
  if (!state.currentUser) return [];
  if (state.currentUser.type === "HM") {
    return [
      { id: "PRICE_LIST", label: "📋 HM Price List (273)" },
      { id: "NEW_BILL", label: "🧾 New Challan / Order" },
      { id: "ORDERS", label: "📦 Self Orders & Packing" },
      { id: "HM_PROFILE", label: "📊 My Statement & Profile" },
      { id: "TEAM_TREE_VIEW", label: "🌳 Team / Tree View" }
    ];
  }
  const role = state.currentUser.role;

  // HM identity mapping and password-field migration are not complete.
  // Until then, expose only features whose data paths are verified and authorized.
  const safeTabs = [
    { id: "PRICE_LIST", label: "📋 HM Price List (273)" },
    { id: "ORDERS", label: "📦 Billing & Dispatch View" }
  ];

  if (state.currentUser.isSuperAdmin) {
    safeTabs.push({ id: "PAYOUTS", label: "💰 Incentive Config & Payouts" });
  }

  return safeTabs;
}

function renderDashboard() {
  if (!state.currentUser) return;

  // Refresh HM rank if logged in as HM
  if (state.currentUser.type === "HM") {
    const liveHm = getLoggedInHmObject();
    if (liveHm) {
      state.currentUser.rankCode = normalizeRankCode(liveHm.rankCode);
      state.currentUser.displayName = liveHm.name;
    }
  }

  document.getElementById("loggedInUserName").textContent = state.currentUser.displayName;
  document.getElementById("loggedInUserRoleBadge").textContent =
    state.currentUser.type === "HM"
      ? `${state.currentUser.hmCode} • Rank: ${normalizeRankCode(state.currentUser.rankCode)}`
      : `${state.currentUser.role.replace(/_/g, " ")}`;

  renderUpperSection();
  renderTabs();
  renderActiveTabBody();
}

function renderUpperSection() {
  const container = document.getElementById("upperSummaryContainer");
  if (!container) return;

  const isHm = state.currentUser.type === "HM";
  if (isHm) {
    // STRICT HM REQUIREMENT: HM login CANNOT view Today Total, Daily Cash, Daily Online, Office Packing/Delivery, Ready Medicine, or Raw Materials.
    // HM ONLY sees Self Orders Invoice Confirmation & Self Orders Packing Update by Order Number and Amount!
    const myBills = state.bills.filter(b => String(b.hmCode || "").toUpperCase() === String(state.currentUser.hmCode || "").toUpperCase());
    const recentSelfBills = myBills.slice(0, 6);

    container.innerHTML = `
      <div class="bg-blue-50/90 border border-blue-800/20 rounded-2xl p-3.5 shadow-xs">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 class="text-sm font-extrabold ub-blue-text">
              🩺 My Self Orders — Invoice Confirmation &amp; Packing Status
            </h2>
            <p class="text-[11px] text-slate-600">
              Health Mitra: <span class="font-bold">${escapeHtml(state.currentUser.displayName)} (${escapeHtml(state.currentUser.hmCode)})</span>
              • Rank: <span class="px-2 py-0.5 rounded bg-blue-700 text-white font-bold text-[10px]">${escapeHtml(normalizeRankCode(state.currentUser.rankCode))}</span>
            </p>
          </div>
          <span class="text-xs font-extrabold ub-blue-text bg-white px-3 py-1 rounded-xl border border-blue-200">
            Total Self Orders: ${myBills.length}
          </span>
        </div>
        ${recentSelfBills.length === 0 ? `
          <div class="text-xs text-slate-500 bg-white rounded-xl p-3 border border-slate-200">
            No self orders placed yet. Use the <b>New Challan / Order</b> tab to create an order.
          </div>
        ` : `
          <div class="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            ${recentSelfBills.map(b => {
              const amt = Number(b.subtotal > 0 ? b.subtotal : b.netAmount).toFixed(0);
              const isConfirmed = b.status === "PAID" || b.status === "APPROVED" || b.verifiedAt > 0;
              const isPackedDelivered = b.status === "DELIVERED" || b.deliveredAt > 0;
              return `
                <div onclick="window.ubApp.openChallanModal('${b.id}')"
                     class="min-w-[230px] bg-white rounded-xl p-2.5 border border-blue-200 shadow-2xs cursor-pointer hover:border-blue-500 transition">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-extrabold text-slate-900">${escapeHtml(b.billNumber)}</span>
                    <span class="text-xs font-black ub-green-text">₹${amt}</span>
                  </div>
                  <div class="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isConfirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                      ${isConfirmed ? '✓ Invoice Confirmed' : '⏳ Pending Confirmation'}
                    </span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPackedDelivered ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}">
                      ${isPackedDelivered ? '📦 Packed & Dispatched' : '📦 Packing in Progress'}
                    </span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>
    `;
    return;
  }

  // OFFICE / ADMIN UPPER SUMMARY
  const todayStr = new Date().toDateString();
  let todayTotal = 0, dailyCash = 0, dailyOnline = 0, pendingVerify = 0, pendingDelivery = 0;

  for (const b of state.bills) {
    const bDateStr = new Date(b.createdAtMs).toDateString();
    const amt = Number(b.subtotal > 0 ? b.subtotal : b.netAmount);
    const isConfirmed = b.status === "PAID" || b.status === "APPROVED" || b.status === "DELIVERED";
    if (bDateStr === todayStr && isConfirmed) {
      todayTotal += amt;
      if (String(b.paymentMode).toUpperCase() === "ONLINE") dailyOnline += amt;
      else dailyCash += amt;
    }
    if (b.status === "PENDING") pendingVerify++;
    if ((b.status === "PAID" || b.status === "APPROVED") && !b.deliveredAt && b.status !== "DELIVERED") pendingDelivery++;
  }

  container.innerHTML = `
    <div class="ub-green-light border border-emerald-800/20 rounded-2xl p-3.5 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div>
          <h2 class="text-sm font-extrabold ub-green-text">
            🏢 UB Ayurved Office Billing &amp; Dispatch Console
          </h2>
          <p class="text-[11px] text-slate-600">
            Logged in: <span class="font-bold">${escapeHtml(state.currentUser.displayName)}</span>
            • Synced in real time with Android App
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div class="bg-white rounded-xl px-3 py-2 border border-emerald-700/25">
          <div class="text-[11px] text-slate-500 font-semibold">Today Total</div>
          <div class="text-base font-black ub-green-text">₹${todayTotal.toFixed(0)}</div>
        </div>
        <div class="bg-white rounded-xl px-3 py-2 border border-emerald-700/25">
          <div class="text-[11px] text-slate-500 font-semibold">Daily Cash</div>
          <div class="text-base font-black ub-green-text">₹${dailyCash.toFixed(0)}</div>
        </div>
        <div class="bg-white rounded-xl px-3 py-2 border border-blue-700/25">
          <div class="text-[11px] text-slate-500 font-semibold">Daily Online</div>
          <div class="text-base font-black ub-blue-text">₹${dailyOnline.toFixed(0)}</div>
        </div>
        <div class="bg-white rounded-xl px-3 py-2 border border-amber-600/30">
          <div class="text-[11px] text-slate-500 font-semibold">Pending Verify</div>
          <div class="text-base font-black ub-amber-text">${pendingVerify} Bills</div>
        </div>
        <div class="bg-white rounded-xl px-3 py-2 border border-blue-700/25">
          <div class="text-[11px] text-slate-500 font-semibold">Packing / Delivery</div>
          <div class="text-base font-black ub-blue-text">${pendingDelivery} Orders</div>
        </div>
      </div>
    </div>
  `;
}

function renderTabs() {
  const nav = document.getElementById("navTabsContainer");
  const tabs = getTabsForCurrentUser();
  if (!tabs.some(t => t.id === state.activeTab)) {
    state.activeTab = tabs[0]?.id || "PRICE_LIST";
  }
  nav.innerHTML = tabs.map(t => {
    const active = t.id === state.activeTab;
    return `
      <button onclick="window.ubApp.setTab('${t.id}')"
              class="px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition ${
                active
                  ? 'ub-green-bg text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }">
        ${t.label}
      </button>
    `;
  }).join("");
}

function renderActiveTabBody() {
  const container = document.getElementById("activeTabContent");
  if (!container) return;

  switch (state.activeTab) {
    case "PRICE_LIST":
      renderPriceListTab(container);
      break;
    case "NEW_BILL":
      renderNewBillTab(container);
      break;
    case "ORDERS":
      renderOrdersTab(container);
      break;
    case "HM_PROFILE":
      renderHmProfileTab(container);
      break;
    case "TEAM_TREE_VIEW":
      renderTeamTreeViewTab(container);
      break;
    case "HEALTH_MITRA":
      renderHealthMitraTab(container);
      break;
    case "PAYOUTS":
      renderPayoutsTab(container);
      break;
    default:
      renderPriceListTab(container);
  }
}

// ============================================================================
// 8. TAB 1: HM PRICE LIST (273 MEDICINES + TIER VISIBILITY + MANUAL EDIT)
// ============================================================================
function renderPriceListTab(container) {
  const allMeds = getMergedMedicines();
  const visibleMode = getVisibleHmTierMode(); // ALL_THREE | ONLY_HM2 | ONLY_HM3
  const canEdit = Boolean(state.currentUser?.canEditMedAndHm);

  const q = state.priceSearch.trim().toLowerCase();
  const filtered = allMeds.filter(m => {
    if (state.priceCategory !== "ALL" && m.category !== state.priceCategory) return false;
    if (!q) return true;
    return (
      String(m.slNo).includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.codeName.toLowerCase().includes(q) ||
      m.quantityNetContent.toLowerCase().includes(q)
    );
  });

  const categories = ["ALL", "Tablets", "Capsules", "Syrups & Liquids", "Oils", "Powders & Care", "Ayurvedic Formulations"];
  const tierBannerText =
    visibleMode === "ONLY_HM2"
      ? "HM2 Tier View: Showing MRP, HM.2 Price & Patient Price only"
      : visibleMode === "ONLY_HM3"
      ? "HM3 Tier View: Showing MRP, HM.3 Price & Patient Price only"
      : "Showing All 3 HM Price Tiers (HM.1, HM.2 & HM.3) + MRP & Patient Price";

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-base font-extrabold ub-green-text">
            UB Ayurved Final Medicine Price List 2026 (${filtered.length} / ${allMeds.length} Items)
          </h3>
          <p class="text-xs text-slate-500 font-semibold">
            ISSUE DATE: 13.11.2026 • ${tierBannerText}
          </p>
        </div>
        <div class="flex items-center gap-2">
          ${canEdit ? `
            <button onclick="window.ubApp.openEditMedicineModal(null)"
                    class="px-3.5 py-2 rounded-xl ub-green-bg text-white text-xs font-extrabold shadow-xs hover:opacity-95">
              + Add Medicine
            </button>
          ` : ""}
        </div>
      </div>

      <!-- Search & Category Filter -->
      <div class="flex flex-col sm:flex-row gap-2.5">
        <input type="text"
               value="${escapeAttr(state.priceSearch)}"
               oninput="window.ubApp.updatePriceSearch(this.value)"
               placeholder="Search by SL.NO, Medicine Name, Code, or Pack Size..."
               class="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700" />
        <select onchange="window.ubApp.updatePriceCategory(this.value)"
                class="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
          ${categories.map(c => `<option value="${c}" ${state.priceCategory === c ? 'selected' : ''}>${c === 'ALL' ? 'All Categories' : c}</option>`).join("")}
        </select>
      </div>

      <!-- Responsive Price Table -->
      <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="ub-green-light text-[#125430] text-[11px] font-extrabold uppercase border-b border-slate-200">
              <th class="py-2.5 px-3">SL.NO</th>
              <th class="py-2.5 px-3">Product Name &amp; Code</th>
              <th class="py-2.5 px-3">Pack / Net</th>
              <th class="py-2.5 px-3 text-right">MRP</th>
              ${visibleMode === "ALL_THREE" ? `
                <th class="py-2.5 px-3 text-right bg-emerald-100/70">HM.1 Price</th>
                <th class="py-2.5 px-3 text-right bg-blue-50">HM.2 Price</th>
                <th class="py-2.5 px-3 text-right bg-amber-50">HM.3 Price</th>
              ` : visibleMode === "ONLY_HM2" ? `
                <th class="py-2.5 px-3 text-right bg-blue-50">HM.2 Price</th>
              ` : `
                <th class="py-2.5 px-3 text-right bg-amber-50">HM.3 Price</th>
              `}
              <th class="py-2.5 px-3 text-right">Patient Price</th>
              ${state.currentUser.type === "OFFICE" ? `<th class="py-2.5 px-3 text-center">Stock</th>` : ""}
              <th class="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 text-xs">
            ${filtered.map(m => `
              <tr class="hover:bg-slate-50/80">
                <td class="py-2.5 px-3 font-extrabold text-slate-600">#${m.slNo}</td>
                <td class="py-2.5 px-3">
                  <div class="font-extrabold text-slate-900">${escapeHtml(m.name)}</div>
                  <div class="text-[10px] text-slate-500 font-semibold">Code: ${escapeHtml(m.codeName)} • ${escapeHtml(m.category)}</div>
                </td>
                <td class="py-2.5 px-3 font-bold text-slate-700">${escapeHtml(m.quantityNetContent)}</td>
                <td class="py-2.5 px-3 text-right font-semibold text-slate-600">₹${m.mrpPrice.toFixed(0)}</td>
                ${visibleMode === "ALL_THREE" ? `
                  <td class="py-2.5 px-3 text-right font-extrabold text-[#125430] bg-emerald-50/50">₹${m.hm1Price.toFixed(0)}</td>
                  <td class="py-2.5 px-3 text-right font-extrabold text-[#164B8A] bg-blue-50/40">₹${m.hm2Price.toFixed(0)}</td>
                  <td class="py-2.5 px-3 text-right font-extrabold text-[#B36B00] bg-amber-50/40">₹${m.hm3Price.toFixed(0)}</td>
                ` : visibleMode === "ONLY_HM2" ? `
                  <td class="py-2.5 px-3 text-right font-extrabold text-[#164B8A] bg-blue-50/40">₹${m.hm2Price.toFixed(0)}</td>
                ` : `
                  <td class="py-2.5 px-3 text-right font-extrabold text-[#B36B00] bg-amber-50/40">₹${m.hm3Price.toFixed(0)}</td>
                `}
                <td class="py-2.5 px-3 text-right font-bold text-slate-800">₹${m.patientPrice.toFixed(0)}</td>
                ${state.currentUser.type === "OFFICE" ? `
                  <td class="py-2.5 px-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${m.stockQuantity > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                      ${m.stockQuantity}
                    </span>
                  </td>
                ` : ""}
                <td class="py-2.5 px-3 text-right whitespace-nowrap space-x-1">
                  <button onclick="window.ubApp.quickAddToBill('${escapeAttr(m.id)}')"
                          class="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#125430] font-extrabold text-[11px] border border-emerald-300">
                    + Bill
                  </button>
                  ${canEdit ? `
                    <button onclick="window.ubApp.openEditMedicineModal('${escapeAttr(m.id)}')"
                            class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#164B8A] font-extrabold text-[11px] border border-blue-300">
                      ✎ Edit Price
                    </button>
                  ` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================================
// 9. TAB 2: NEW CHALLAN / BILLING (AUTO HM TIER PRICING + ONLINE DETAILS)
// ============================================================================
function renderNewBillTab(container) {
  const allMeds = getMergedMedicines();
  const isHm = state.currentUser.type === "HM";
  if (isHm && state.currentUser.hmCode) {
    state.billSelectedHmCode = state.currentUser.hmCode;
  }
  const selectedHm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(state.billSelectedHmCode).toUpperCase()) || null;
  const targetRank = normalizeRankCode(selectedHm?.rankCode || (isHm ? state.currentUser.rankCode : "HM1"));
  const visibleMode = getVisibleHmTierMode();

  const medQ = state.billMedSearch.trim().toLowerCase();
  const matchingMeds = allMeds.filter(m => {
    if (!medQ) return true;
    return (
      String(m.slNo).includes(medQ) ||
      m.name.toLowerCase().includes(medQ) ||
      m.codeName.toLowerCase().includes(medQ)
    );
  }).slice(0, 35);

  const totalHmAmount = state.billItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  const totalMrpAmount = state.billItems.reduce((acc, it) => acc + (it.mrp * it.quantity), 0);

  container.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Left Column: Select HM & Add Medicines -->
      <div class="lg:col-span-7 bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-4">
        <h3 class="text-base font-extrabold ub-green-text">1. Select Health Mitra &amp; Medicines</h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Health Mitra Account</label>
            ${isHm ? `
              <div class="rounded-xl bg-slate-100 border border-slate-300 px-3 py-2 text-xs font-extrabold text-slate-900">
                ${escapeHtml(state.currentUser.displayName)} (${escapeHtml(state.currentUser.hmCode)}) • [${escapeHtml(targetRank)}]
              </div>
            ` : `
              <select onchange="window.ubApp.selectBillHm(this.value)"
                      class="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">
                <option value="">-- Select Registered Health Mitra --</option>
                ${state.healthMitras.map(h => `
                  <option value="${escapeAttr(h.hmCode)}" ${String(h.hmCode).toUpperCase() === String(state.billSelectedHmCode).toUpperCase() ? 'selected' : ''}>
                    ${escapeHtml(h.name)} (${escapeHtml(h.hmCode)}) — [${escapeHtml(normalizeRankCode(h.rankCode))}]
                  </option>
                `).join("")}
              </select>
            `}
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Billing Rate Mode</label>
            <select onchange="window.ubApp.selectBillMode(this.value)"
                    class="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">
              <option value="DISPENSARY_CHALLAN" ${state.billMode === 'DISPENSARY_CHALLAN' ? 'selected' : ''}>
                Dispensary Transfer (${targetRank} Price Tier)
              </option>
              <option value="WITH_RETAIL_PROFIT" ${state.billMode === 'WITH_RETAIL_PROFIT' ? 'selected' : ''}>
                Patient Price Mode
              </option>
            </select>
          </div>
        </div>

        <!-- Medicine Search & Add List -->
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Search Medicine to Add to Challan</label>
          <input type="text"
                 value="${escapeAttr(state.billMedSearch)}"
                 oninput="window.ubApp.updateBillMedSearch(this.value)"
                 placeholder="Type Medicine Name, Code, or SL.NO..."
                 class="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-700" />
        </div>

        <div class="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-200">
          ${matchingMeds.map(m => {
            const unitRate = state.billMode === "WITH_RETAIL_PROFIT" ? m.patientPrice : getPriceForHmRank(m, targetRank);
            return `
              <div class="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50">
                <div>
                  <div class="text-xs font-extrabold text-slate-900">#${m.slNo} ${escapeHtml(m.name)} <span class="text-slate-500 font-semibold">(${escapeHtml(m.quantityNetContent)})</span></div>
                  <div class="text-[11px] text-slate-600 font-semibold">
                    MRP: ₹${m.mrpPrice.toFixed(0)} •
                    ${visibleMode === "ALL_THREE"
                      ? `HM1: ₹${m.hm1Price} | HM2: ₹${m.hm2Price} | HM3: ₹${m.hm3Price}`
                      : `${targetRank} Rate: ₹${unitRate}`}
                  </div>
                </div>
                <button onclick="window.ubApp.addMedToBill('${escapeAttr(m.id)}')"
                        class="px-3 py-1.5 rounded-xl ub-green-bg text-white text-xs font-extrabold shadow-2xs">
                  + Add (₹${unitRate})
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Right Column: Challan Cart & Payment Details -->
      <div class="lg:col-span-5 bg-white rounded-2xl shadow-xs border border-slate-200 p-4 flex flex-col justify-between space-y-4">
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-extrabold ub-green-text">2. Stock Transfer Challan Cart</h3>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold ub-green-light ub-green-text">
              ${state.billItems.length} Items
            </span>
          </div>

          ${state.billItems.length === 0 ? `
            <div class="text-xs text-slate-500 bg-slate-50 rounded-xl p-6 text-center border border-dashed border-slate-300">
              No medicines added yet. Click <b>+ Add</b> on any medicine from the left panel.
            </div>
          ` : `
            <div class="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-200">
              ${state.billItems.map((it, idx) => `
                <div class="p-2.5 flex items-center justify-between gap-2 text-xs">
                  <div class="flex-1">
                    <div class="font-extrabold text-slate-900">${escapeHtml(it.medicineName)}</div>
                    <div class="text-[11px] text-slate-500">Rate: ₹${it.unitPrice} × ${it.quantity} = <b class="text-slate-900">₹${(it.unitPrice * it.quantity).toFixed(0)}</b> (MRP ₹${(it.mrp * it.quantity).toFixed(0)})</div>
                  </div>
                  <div class="flex items-center gap-1">
                    <button onclick="window.ubApp.changeBillItemQty(${idx}, -1)" class="w-6 h-6 rounded bg-slate-200 font-bold">-</button>
                    <span class="w-7 text-center font-extrabold">${it.quantity}</span>
                    <button onclick="window.ubApp.changeBillItemQty(${idx}, 1)" class="w-6 h-6 rounded bg-slate-200 font-bold">+</button>
                    <button onclick="window.ubApp.removeBillItem(${idx})" class="ml-1 text-red-600 font-bold px-1.5">✕</button>
                  </div>
                </div>
              `).join("")}
            </div>
          `}

          <!-- Payment Mode -->
          <div class="pt-2 border-t border-slate-200 space-y-2.5">
            <label class="block text-xs font-bold text-slate-700">Payment Mode</label>
            <div class="grid grid-cols-3 gap-2">
              ${["CASH", "ONLINE", "CREDIT"].map(pm => `
                <button onclick="window.ubApp.setBillPaymentMode('${pm}')"
                        class="py-2 rounded-xl text-xs font-extrabold border transition ${
                          state.billPaymentMode === pm
                            ? 'ub-blue-bg text-white border-blue-900'
                            : 'bg-slate-50 text-slate-700 border-slate-300'
                        }">
                  ${pm}
                </button>
              `).join("")}
            </div>

            ${state.billPaymentMode === "ONLINE" ? `
              <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                <div class="text-xs font-extrabold ub-blue-text">Online Payment Details (Printed on Challan)</div>
                <div class="grid grid-cols-3 gap-2">
                  <div>
                    <label class="block text-[10px] font-bold text-slate-600">Amount (₹)</label>
                    <input type="text" id="onlineAmtInput" value="${escapeAttr(state.billOnlineAmount || String(totalHmAmount))}"
                           oninput="window.ubApp.setOnlineField('amount', this.value)"
                           class="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold bg-white" />
                  </div>
                  <div>
                    <label class="block text-[10px] font-bold text-slate-600">Date</label>
                    <input type="date" value="${escapeAttr(state.billOnlineDate)}"
                           onchange="window.ubApp.setOnlineField('date', this.value)"
                           class="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold bg-white" />
                  </div>
                  <div>
                    <label class="block text-[10px] font-bold text-slate-600">Time</label>
                    <input type="time" value="${escapeAttr(state.billOnlineTime)}"
                           onchange="window.ubApp.setOnlineField('time', this.value)"
                           class="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold bg-white" />
                  </div>
                </div>
              </div>
            ` : ""}
          </div>
        </div>

        <!-- Totals & Submit -->
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
          <div class="flex justify-between text-xs font-bold text-slate-600">
            <span>Total MRP Value (Incl. all taxes):</span>
            <span>₹${totalMrpAmount.toFixed(0)}</span>
          </div>
          <div class="flex justify-between text-sm font-black ub-green-text">
            <span>Total HM Challan Amount (${targetRank}):</span>
            <span>₹${totalHmAmount.toFixed(0)}</span>
          </div>
          <button onclick="window.ubApp.submitNewChallan()"
                  class="w-full py-3 rounded-xl ub-green-bg hover:opacity-95 text-white font-extrabold text-xs shadow-md transition">
            ✓ Generate Stock Transfer Challan &amp; Sync to Cloud
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 10. TAB 3: ORDERS & DISPATCH (WITH PDF CHALLAN GENERATOR)
// ============================================================================
function renderOrdersTab(container) {
  const isHm = state.currentUser.type === "HM";
  const q = state.ordersSearch.trim().toLowerCase();

  const sourceBills = isHm
    ? state.bills.filter(b => String(b.hmCode || "").toUpperCase() === String(state.currentUser.hmCode || "").toUpperCase())
    : state.bills;

  const filtered = sourceBills.filter(b => {
    if (!q) return true;
    return (
      String(b.billNumber || "").toLowerCase().includes(q) ||
      String(b.hmName || "").toLowerCase().includes(q) ||
      String(b.hmCode || "").toLowerCase().includes(q)
    );
  });

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-base font-extrabold ub-green-text">
            ${isHm ? "My Self Orders & Packing Updates" : "All Health Mitra Challans & Dispatch Orders"} (${filtered.length})
          </h3>
          <p class="text-xs text-slate-500">Click any order to view or download the official Stock Transfer Challan PDF named with HM Name &amp; Date.</p>
        </div>
        <input type="text"
               value="${escapeAttr(state.ordersSearch)}"
               oninput="window.ubApp.updateOrdersSearch(this.value)"
               placeholder="Search Order No, HM Name, HM ID..."
               class="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold w-full sm:w-72" />
      </div>

      <div class="space-y-2.5">
        ${filtered.length === 0 ? `
          <div class="text-xs text-slate-500 p-6 text-center bg-slate-50 rounded-xl border border-slate-200">
            No orders matching your filter.
          </div>
        ` : filtered.map(b => {
          const amt = Number(b.subtotal > 0 ? b.subtotal : b.netAmount).toFixed(0);
          const dateStr = new Date(b.createdAtMs).toLocaleDateString("en-GB");
          const isConfirmed = b.status === "PAID" || b.status === "APPROVED" || b.status === "DELIVERED";
          const isDelivered = b.status === "DELIVERED" || b.deliveredAt > 0;
          return `
            <div class="border border-slate-200 rounded-xl p-3.5 hover:border-emerald-600/50 transition flex flex-wrap items-center justify-between gap-3 bg-white">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-black text-slate-900">${escapeHtml(b.billNumber)}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-[#125430]">
                    ${escapeHtml(b.hmName || "Walk-In")} (${escapeHtml(b.hmCode || "DIRECT")})
                  </span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                    ${escapeHtml(b.paymentMode)} • ${dateStr}
                  </span>
                </div>
                <div class="text-xs text-slate-600">
                  Items: <b>${(b.items || []).length}</b> • Total HM Amount: <b class="ub-green-text">₹${amt}</b>
                  ${b.notes ? ` • <span class="text-blue-700 font-semibold">${escapeHtml(b.notes)}</span>` : ""}
                </div>
                <div class="flex items-center gap-2 pt-0.5">
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${isConfirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                    ${isConfirmed ? `✓ Verified (${escapeHtml(b.verifiedBy || 'Office')})` : '⏳ Pending Verification'}
                  </span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${isDelivered ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}">
                    ${isDelivered ? `🚚 Packed & Dispatched (${escapeHtml(b.deliveredBy || 'Jeet')})` : '📦 Packing Pending'}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <button onclick="window.ubApp.openChallanModal('${b.id}')"
                        class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs">
                  👁️ View Challan
                </button>
                <button onclick="window.ubApp.downloadChallanPdf('${b.id}')"
                        class="px-3 py-1.5 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow-2xs">
                  📄 Download PDF
                </button>
                ${!isHm && !isConfirmed && state.currentUser.canVerifyBilling ? `
                  <button onclick="window.ubApp.verifyBillOrder('${b.id}')"
                          class="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs">
                    ✓ Verify Payment
                  </button>
                ` : ""}
                ${!isHm && isConfirmed && !isDelivered && (state.currentUser.canConfirmDelivery || state.currentUser.canVerifyBilling) ? `
                  <button onclick="window.ubApp.markOrderDelivered('${b.id}')"
                          class="px-3 py-1.5 rounded-xl ub-blue-bg text-white font-extrabold text-xs">
                    📦 Mark Packed &amp; Delivered
                  </button>
                ` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ============================================================================
// 11. TAB 4: HM INCENTIVE, STATEMENT & PROMOTION
// ============================================================================
function renderHmProfileTab(container) {
  const isHm = state.currentUser.type === "HM";
  const list = isHm
    ? state.healthMitras.filter(h => String(h.hmCode).toUpperCase() === String(state.currentUser.hmCode).toUpperCase())
    : state.healthMitras;

  container.innerHTML = `
    <div class="space-y-3">
      ${list.map(hm => {
        const rankCode = normalizeRankCode(hm.rankCode);
        const rankTitle = getRankTitle(rankCode);
        const isOtherRank = !isHmSelfTier(rankCode);
        const ov = state.incentiveSettings.memberOverrides?.[hm.hmCode.toUpperCase()] || {};
        const selectedOption = ov.selectedOption || "OPTION_1_SELF";
        const selfPct = ov.customSelfPct ?? (isOtherRank ? (state.incentiveSettings.rankSelfPctMap[rankCode] ?? 8) : (state.incentiveSettings.rankSelfPctMap.HM ?? state.incentiveSettings.hmManualPct ?? 5));
        const teamPct = ov.customTeamPct ?? (isOtherRank ? (state.incentiveSettings.rankTeamPctMap[rankCode] ?? 3) : 0);

        const selfSales = calcPaidSalesForHm(hm.hmCode);
        const downlineHms = getDownlineHms(hm.hmCode);
        const teamSales = downlineHms.reduce((acc, d) => acc + calcPaidSalesForHm(d.hmCode), 0);
        const earnedSelf = (selfSales * selfPct) / 100;
        const earnedTeam = (teamSales * teamPct) / 100;
        const activePayout = !isOtherRank
          ? earnedSelf
          : (selectedOption === "OPTION_2_TEAM" ? earnedTeam : earnedSelf);

        return `
          <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                ${renderAvatarHtml(hm, 48)}
                <div>
                  <div class="flex items-center gap-2">
                    <h4 class="text-base font-black text-slate-900">${escapeHtml(hm.name)}</h4>
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold ub-green-light ub-green-text">${escapeHtml(hm.hmCode)}</span>
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold ub-blue-light ub-blue-text">${escapeHtml(rankCode)} — ${escapeHtml(rankTitle)}</span>
                  </div>
                  <div class="text-xs text-slate-500 font-medium">
                    📱 ${escapeHtml(hm.mobileNo)} • 📍 ${escapeHtml(hm.hmAddress || hm.gpName || hm.branch)}
                    ${hm.sponsorHmId ? ` • Upline Sponsor: <b>${escapeHtml(hm.sponsorHmId)}</b>` : ""}
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                ${state.currentUser.isSuperAdmin ? `
                  <button onclick="window.ubApp.openPromoteModal('${escapeAttr(hm.hmCode)}')"
                          class="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shadow-2xs">
                    🎖️ Super Admin: Promote Rank
                  </button>
                  <button onclick="window.ubApp.openMemberIncentiveModal('${escapeAttr(hm.hmCode)}')"
                          class="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#164B8A] border border-blue-300 font-extrabold text-xs">
                    ⚙️ Adjust Incentive %
                  </button>
                ` : ""}
                ${state.currentUser.canEditMedAndHm ? `
                  <button onclick="window.ubApp.openEditHmProfileModal('${escapeAttr(hm.hmCode)}')"
                          class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs">
                    ✎ Edit Profile / Password
                  </button>
                ` : ""}
              </div>
            </div>

            <!-- Two-Option Selector for Other Rank Holders (MR..RSM) -->
            ${isOtherRank ? `
              <div class="bg-blue-50/70 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                <div class="text-xs font-extrabold ub-blue-text">
                  Rank Holder Incentive Mode (${escapeHtml(rankCode)}): Choose Option 1 (Self Business) or Option 2 (Team Business)
                </div>
                <div class="flex items-center gap-2">
                  <button onclick="window.ubApp.selectRankIncentiveOption('${escapeAttr(hm.hmCode)}', 'OPTION_1_SELF')"
                          class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                            selectedOption === 'OPTION_1_SELF' ? 'ub-green-bg text-white' : 'bg-white text-slate-700 border border-slate-300'
                          }">
                    Option 1: Self Business (${selfPct}% = ₹${earnedSelf.toFixed(0)})
                  </button>
                  <button onclick="window.ubApp.selectRankIncentiveOption('${escapeAttr(hm.hmCode)}', 'OPTION_2_TEAM')"
                          class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                            selectedOption === 'OPTION_2_TEAM' ? 'ub-blue-bg text-white' : 'bg-white text-slate-700 border border-slate-300'
                          }">
                    Option 2: Team Business (${teamPct}% = ₹${earnedTeam.toFixed(0)})
                  </button>
                </div>
              </div>
            ` : ""}

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
                <div class="text-slate-500 font-semibold">Paid Self Business</div>
                <div class="text-sm font-black text-slate-900">₹${selfSales.toFixed(0)} (${selfPct}%)</div>
              </div>
              <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
                <div class="text-slate-500 font-semibold">Downline Team Business</div>
                <div class="text-sm font-black text-slate-900">₹${teamSales.toFixed(0)} (${teamPct}%)</div>
              </div>
              <div class="bg-emerald-50 rounded-xl p-2.5 border border-emerald-200">
                <div class="text-emerald-800 font-semibold">Active Incentive Payout</div>
                <div class="text-sm font-black ub-green-text">₹${activePayout.toFixed(0)}</div>
              </div>
              <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200">
                <div class="text-slate-500 font-semibold">Downline Members</div>
                <div class="text-sm font-black text-slate-900">${downlineHms.length} Members</div>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// ============================================================================
// 12. TAB 5: CLEAN ORG-CHART TEAM / TREE VIEW (MATCHING tree.jfif, NO GREEN BANNER)
// ============================================================================
function calcPaidSalesForHm(hmCode) {
  const clean = String(hmCode || "").toUpperCase();
  return state.bills
    .filter(b => String(b.hmCode || "").toUpperCase() === clean && (b.status === "PAID" || b.status === "APPROVED" || b.status === "DELIVERED"))
    .reduce((acc, b) => acc + Number(b.subtotal > 0 ? b.subtotal : b.netAmount), 0);
}

function getPaidInvoicesForHm(hmCode) {
  const clean = String(hmCode || "").toUpperCase();
  return state.bills.filter(
    b => String(b.hmCode || "").toUpperCase() === clean && (b.status === "PAID" || b.status === "APPROVED" || b.status === "DELIVERED")
  );
}

function getDownlineHms(sponsorCode) {
  const result = [];
  const visited = new Set();
  function dfs(code) {
    const clean = String(code || "").toUpperCase();
    for (const h of state.healthMitras) {
      const hCode = String(h.hmCode || "").toUpperCase();
      if (String(h.sponsorHmId || "").toUpperCase() === clean && !visited.has(hCode)) {
        visited.add(hCode);
        result.push(h);
        dfs(hCode);
      }
    }
  }
  dfs(sponsorCode);
  return result;
}

function renderAvatarHtml(hm, sizePx = 56) {
  const initials = String(hm.name || "HM")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || "")
    .join("") || "HM";
  if (hm.photoUri && (hm.photoUri.startsWith("data:image") || hm.photoUri.startsWith("http"))) {
    return `<img src="${escapeAttr(hm.photoUri)}" alt="${escapeAttr(hm.name)}" style="width:${sizePx}px;height:${sizePx}px" class="rounded-full object-cover border-2 border-slate-800 shadow-xs bg-white" />`;
  }
  return `<div style="width:${sizePx}px;height:${sizePx}px" class="rounded-full bg-emerald-50 border-2 border-slate-800 flex items-center justify-center font-black text-slate-800 text-xs shadow-xs">${escapeHtml(initials)}</div>`;
}

function buildTreeHtmlNode(hm, depth = 0) {
  const children = state.healthMitras.filter(
    c => String(c.sponsorHmId || "").toUpperCase() === String(hm.hmCode || "").toUpperCase() &&
         String(c.hmCode || "").toUpperCase() !== String(hm.hmCode || "").toUpperCase()
  );
  const rankCode = normalizeRankCode(hm.rankCode);
  const paidTotal = calcPaidSalesForHm(hm.hmCode);

  return `
    <li class="tree-li">
      <div class="inline-flex flex-col items-center">
        <button onclick="window.ubApp.openTreeMemberPaidModal('${escapeAttr(hm.hmCode)}')"
                title="Click photo to view Successful Paid Invoices Total"
                class="group focus:outline-none flex flex-col items-center">
          <div class="transition transform group-hover:scale-105">
            ${renderAvatarHtml(hm, depth === 0 ? 68 : 54)}
          </div>
          <div class="mt-1.5 bg-white border border-slate-300 rounded-xl px-3 py-1 shadow-xs min-w-[115px] text-center group-hover:border-slate-900">
            <div class="text-[11px] font-extrabold text-slate-900 leading-tight">${escapeHtml(hm.name)}</div>
            <div class="text-[10px] font-bold text-slate-500">${escapeHtml(hm.hmCode)} • <span class="text-emerald-800">${escapeHtml(rankCode)}</span></div>
            <div class="text-[10px] font-extrabold text-emerald-700 mt-0.5">Paid: ₹${paidTotal.toFixed(0)}</div>
          </div>
        </button>
      </div>
      ${children.length > 0 && depth < 4 ? `
        <ul class="tree-ul">
          ${children.map(ch => buildTreeHtmlNode(ch, depth + 1)).join("")}
        </ul>
      ` : ""}
    </li>
  `;
}

function renderTeamTreeViewTab(container) {
  const isHm = state.currentUser.type === "HM";
  if (isHm && state.currentUser.hmCode) {
    state.treeRootHmCode = state.currentUser.hmCode;
  } else if (!state.treeRootHmCode && state.healthMitras.length > 0) {
    state.treeRootHmCode = state.healthMitras[0].hmCode;
  }

  const rootHm = state.healthMitras.find(
    h => String(h.hmCode).toUpperCase() === String(state.treeRootHmCode).toUpperCase()
  ) || state.healthMitras[0] || null;

  // Notice: Green banner ("Professional MLM Team / Tree View") is completely removed as requested!
  // Clean white canvas org chart matching tree.jfif, clicking any member photo shows Successful Paid Invoices Total.
  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div class="text-xs text-slate-600 font-semibold">
          💡 Click on any team member's circular photo to view their <b>Successful Paid Invoices Total</b> &amp; invoice history.
        </div>
        ${!isHm ? `
          <div class="flex items-center gap-2">
            <label class="text-xs font-bold text-slate-600">Select Upline Root HM:</label>
            <select onchange="window.ubApp.setTreeRootHm(this.value)"
                    class="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold">
              ${state.healthMitras.map(h => `
                <option value="${escapeAttr(h.hmCode)}" ${String(h.hmCode).toUpperCase() === String(rootHm?.hmCode || "").toUpperCase() ? 'selected' : ''}>
                  ${escapeHtml(h.name)} (${escapeHtml(h.hmCode)}) — [${escapeHtml(normalizeRankCode(h.rankCode))}]
                </option>
              `).join("")}
            </select>
          </div>
        ` : ""}
      </div>

      ${!rootHm ? `
        <div class="p-8 text-center text-xs text-slate-500">No Health Mitra records available yet.</div>
      ` : `
        <div class="overflow-x-auto bg-white rounded-xl py-4">
          <div class="tree-container">
            <ul class="tree-ul" style="padding-top:0">
              ${buildTreeHtmlNode(rootHm, 0)}
            </ul>
          </div>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 13. TAB 6: HM REGISTRATION & MANAGEMENT (SONALI, KOUSHIK & SUPER ADMIN)
// ============================================================================
function renderHealthMitraTab(container) {
  const q = state.hmSearch.trim().toLowerCase();
  const filtered = state.healthMitras.filter(h => {
    if (!q) return true;
    return (
      String(h.name || "").toLowerCase().includes(q) ||
      String(h.hmCode || "").toLowerCase().includes(q) ||
      String(h.mobileNo || "").toLowerCase().includes(q)
    );
  });

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-base font-extrabold ub-green-text">
            Health Mitra Directory &amp; Registration (${filtered.length})
          </h3>
          <p class="text-xs text-slate-500">
            Includes MR &amp; under-MR tiers (HM1, HM2, HM3) + Senior Designations (SR–RSM).
          </p>
        </div>
        <div class="flex items-center gap-2">
          <input type="text"
                 value="${escapeAttr(state.hmSearch)}"
                 oninput="window.ubApp.updateHmSearch(this.value)"
                 placeholder="Search HM Name, ID, Mobile..."
                 class="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold" />
          <button onclick="window.ubApp.openRegisterHmModal()"
                  class="px-3.5 py-2 rounded-xl ub-green-bg text-white text-xs font-extrabold shadow-xs">
            + Register HM
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${filtered.map(h => {
          const rankCode = normalizeRankCode(h.rankCode);
          return `
            <div class="border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between gap-3 hover:border-emerald-600/40">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                  ${renderAvatarHtml(h, 46)}
                  <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-sm font-black text-slate-900">${escapeHtml(h.name)}</span>
                      <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ub-green-light ub-green-text">${escapeHtml(h.hmCode)}</span>
                      <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ub-blue-light ub-blue-text">${escapeHtml(rankCode)}</span>
                    </div>
                    <div class="text-xs text-slate-500">📱 ${escapeHtml(h.mobileNo)} • 📍 ${escapeHtml(h.hmAddress || h.gpName || h.branch)}</div>
                    <div class="text-[11px] text-slate-500">
                      Upline: <b>${escapeHtml(h.sponsorHmId || "Direct")}</b> •
                      Status: <b class="${h.isVerified ? 'text-emerald-700' : 'text-amber-700'}">${h.isVerified ? '✓ Verified' : '⏳ Pending Verification'}</b>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-end gap-2 flex-wrap pt-2 border-t border-slate-100">
                ${!h.isVerified && state.currentUser.canVerifyBilling ? `
                  <button onclick="window.ubApp.verifyHm('${escapeAttr(h.hmCode)}')"
                          class="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-extrabold text-[11px]">
                    ✓ Verify HM
                  </button>
                ` : ""}
                ${state.currentUser.isSuperAdmin ? `
                  <button onclick="window.ubApp.openPromoteModal('${escapeAttr(h.hmCode)}')"
                          class="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px]">
                    🎖️ Promote
                  </button>
                ` : ""}
                ${state.currentUser.canEditMedAndHm ? `
                  <button onclick="window.ubApp.openEditHmProfileModal('${escapeAttr(h.hmCode)}')"
                          class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#164B8A] border border-blue-200 font-extrabold text-[11px]">
                    ✎ Edit Profile / Password
                  </button>
                ` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ============================================================================
// 14. TAB 7: SUPER ADMIN INCENTIVE CONFIGURATION & PAYOUTS
// ============================================================================
function renderPayoutsTab(container) {
  const isSuper = Boolean(state.currentUser?.isSuperAdmin);
  const s = state.incentiveSettings;
  const ranks = ["HM", "MR", "SR", "SE", "SO", "TSM", "ASM", "RSM"];

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-base font-extrabold ub-green-text">
            Super Admin Incentive Percentage Configuration
          </h3>
          <p class="text-xs text-slate-500">
            Synced live with Android App via <code class="font-bold">commission_config/incentive_rules_v2</code>.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div class="text-xs font-extrabold ub-green-text">Option 1: Self Business Incentive % by Rank</div>
          ${ranks.map(r => `
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-700">${r === 'HM' ? 'HM (HM1 / HM2 / HM3 Self)' : r}</span>
              <input type="number" step="0.5" id="selfPct_${r}" value="${Number(s.rankSelfPctMap[r] ?? 5)}"
                     ${!isSuper ? 'disabled' : ''}
                     class="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-right font-extrabold" />
            </div>
          `).join("")}
        </div>

        <div class="border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div class="text-xs font-extrabold ub-blue-text">Option 2: Team Business Incentive % by Rank</div>
          ${ranks.map(r => `
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-700">${r} Team %</span>
              <input type="number" step="0.5" id="teamPct_${r}" value="${Number(s.rankTeamPctMap[r] ?? 0)}"
                     ${!isSuper ? 'disabled' : ''}
                     class="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-right font-extrabold" />
            </div>
          `).join("")}
        </div>
      </div>

      ${isSuper ? `
        <button onclick="window.ubApp.saveGlobalIncentives()"
                class="px-5 py-2.5 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow-sm">
          💾 Save Global Incentive Percentages to Cloud
        </button>
      ` : `
        <div class="text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200 font-semibold">
          Only Super Admin can modify global incentive percentages.
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// 15. MODALS: EDIT MEDICINE, REGISTER/EDIT HM, PROMOTE HM, TREE PAID INVOICES, CHALLAN VIEW
// ============================================================================
function openModal(title, bodyHtml) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
}

function openEditMedicineModal(medId) {
  if (!state.currentUser?.canEditMedAndHm) {
    showToast("Only Super Admin, Sonali & Koushik can edit medicine prices.");
    return;
  }
  const allMeds = getMergedMedicines();
  const existing = medId ? allMeds.find(m => m.id.toLowerCase() === String(medId).toLowerCase()) : null;
  const nextSlNo = existing ? existing.slNo : (Math.max(275, ...allMeds.map(m => m.slNo)) + 1);

  openModal(existing ? `Edit Medicine #${existing.slNo} — ${existing.name}` : "Add New Medicine to 2026 Price List", `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="font-bold text-slate-700">SL.NO</label>
        <input id="editMedSlNo" type="number" value="${nextSlNo}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Pack Size / Qnty Net</label>
        <input id="editMedPack" type="text" value="${escapeAttr(existing?.quantityNetContent || '60 TAB.')}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div class="sm:col-span-2">
        <label class="font-bold text-slate-700">Medicine Name</label>
        <input id="editMedName" type="text" value="${escapeAttr(existing?.name || '')}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Short Code Name (for Challan)</label>
        <input id="editMedCode" type="text" value="${escapeAttr(existing?.codeName || '')}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Stock Quantity</label>
        <input id="editMedStock" type="number" value="${Number(existing?.stockQuantity || 0)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">MRP Price (₹)</label>
        <input id="editMedMrp" type="number" step="0.01" value="${Number(existing?.mrpPrice || 0)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-[#125430]">HM.1 Price (₹)</label>
        <input id="editMedHm1" type="number" step="0.01" value="${Number(existing?.hm1Price || 0)}" class="w-full rounded-xl border border-emerald-400 px-3 py-2 font-extrabold mt-1 bg-emerald-50/40" />
      </div>
      <div>
        <label class="font-bold text-[#164B8A]">HM.2 Price (₹)</label>
        <input id="editMedHm2" type="number" step="0.01" value="${Number(existing?.hm2Price || 0)}" class="w-full rounded-xl border border-blue-400 px-3 py-2 font-extrabold mt-1 bg-blue-50/40" />
      </div>
      <div>
        <label class="font-bold text-[#B36B00]">HM.3 Price (₹)</label>
        <input id="editMedHm3" type="number" step="0.01" value="${Number(existing?.hm3Price || 0)}" class="w-full rounded-xl border border-amber-400 px-3 py-2 font-extrabold mt-1 bg-amber-50/40" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Patient Price (₹)</label>
        <input id="editMedPatient" type="number" step="0.01" value="${Number(existing?.patientPrice || 0)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
    </div>
    <div class="pt-4 flex justify-end gap-2">
      <button onclick="window.ubApp.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">Cancel</button>
      <button onclick="window.ubApp.saveMedicinePriceOverride('${escapeAttr(existing?.id || '')}')"
              class="px-5 py-2 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow">
        💾 Save Medicine &amp; Sync to Cloud
      </button>
    </div>
  `);
}

async function saveMedicinePriceOverride(existingId) {
  const slNo = Number(document.getElementById("editMedSlNo").value || 1);
  const name = document.getElementById("editMedName").value.trim();
  const pack = document.getElementById("editMedPack").value.trim();
  const codeName = document.getElementById("editMedCode").value.trim() || deriveCodeName(name);
  const stockQuantity = Number(document.getElementById("editMedStock").value || 0);
  const mrpPrice = Number(document.getElementById("editMedMrp").value || 0);
  const hm1Price = Number(document.getElementById("editMedHm1").value || 0);
  const hm2Price = Number(document.getElementById("editMedHm2").value || 0);
  const hm3Price = Number(document.getElementById("editMedHm3").value || 0);
  const patientPrice = Number(document.getElementById("editMedPatient").value || 0);

  if (!name) {
    showToast("Medicine name is required.");
    return;
  }

  const id = (existingId || `med_${slNo}`).toLowerCase();
  const entry = {
    id,
    slNo,
    name,
    codeName,
    quantityNetContent: pack,
    mrpPrice,
    hm1Price,
    hm2Price,
    hm3Price,
    patientPrice,
    category: inferCategory(name, pack),
    stockQuantity
  };

  state.medicineOverrides[id] = entry;
  const arr = Object.values(state.medicineOverrides);
  const updatedBy = state.currentUser?.displayName || "Admin";

  try {
    await setDoc(doc(db, "commission_config", "medicine_price_list_2026"), {
      jsonPayload: JSON.stringify(arr),
      updatedBy,
      updatedAt: Date.now()
    });
    await setDoc(doc(db, "medicines", id), {
      slNo,
      name,
      codeName,
      quantityNetContent: pack,
      mrpPrice,
      hmPrice: hm1Price,
      patientPrice,
      stockQuantity,
      lowStockThreshold: 10,
      batchNumber: "UB26-01",
      expiryDate: "11/2028",
      category: entry.category,
      status: stockQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
      branchStock: { "Belda HQ": stockQuantity },
      updatedBy,
      updatedAt: Timestamp.now()
    }, { merge: true });

    closeModal();
    showToast(`Saved ${name} and synced to Android + Web Cloud!`);
  } catch (e) {
    showToast("Cloud sync error: " + e.message);
  }
}

function openRegisterHmModal() {
  const nextNum = state.healthMitras.length + 1;
  const suggestedCode = `HM${String(nextNum).padStart(3, "0")}`;

  openModal("Register New Health Mitra (Includes HM1, HM2, HM3 under MR)", `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="font-bold text-slate-700">HM Code</label>
        <input id="regHmCode" type="text" value="${suggestedCode}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-extrabold uppercase mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Select Rank / Tier (HM1, HM2, HM3 under MR)</label>
        <select id="regHmRank" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-extrabold mt-1">
          ${MEMBER_RANK_OPTIONS.map(r => `
            <option value="${r.code}" ${r.code === 'HM1' ? 'selected' : ''}>
              ${r.code} — ${r.title} (${r.badgeHint})
            </option>
          `).join("")}
        </select>
      </div>
      <div>
        <label class="font-bold text-slate-700">Full Name</label>
        <input id="regHmName" type="text" placeholder="Enter Full Name" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Mobile Number</label>
        <input id="regHmMobile" type="text" placeholder="10-digit Mobile" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Upline Sponsor HM Code (Optional)</label>
        <input id="regHmSponsor" type="text" placeholder="e.g. HM001" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold uppercase mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Login Password</label>
        <input id="regHmPass" type="text" value="123456" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div class="sm:col-span-2">
        <label class="font-bold text-slate-700">Address / GP / Pincode</label>
        <input id="regHmAddress" type="text" placeholder="Village / Town, GP, Pincode" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
    </div>
    <div class="pt-4 flex justify-end gap-2">
      <button onclick="window.ubApp.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">Cancel</button>
      <button onclick="window.ubApp.submitRegisterHm()" class="px-5 py-2 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow">
        ✓ Register Health Mitra
      </button>
    </div>
  `);
}

async function submitRegisterHm() {
  const hmCode = document.getElementById("regHmCode").value.trim().toUpperCase();
  const rankCode = normalizeRankCode(document.getElementById("regHmRank").value);
  const name = document.getElementById("regHmName").value.trim();
  const mobileNo = document.getElementById("regHmMobile").value.trim();
  const sponsorHmId = document.getElementById("regHmSponsor").value.trim().toUpperCase();
  const password = document.getElementById("regHmPass").value.trim() || "123456";
  const hmAddress = document.getElementById("regHmAddress").value.trim();

  if (!hmCode || !name || !mobileNo) {
    showToast("HM Code, Name, and Mobile Number are required.");
    return;
  }

  const isOffice = state.currentUser?.type === "OFFICE";
  const payload = {
    id: hmCode,
    hmCode,
    name,
    mobileNo,
    hmAddress,
    gpName: hmAddress,
    pincode: "",
    branch: "Belda HQ",
    photoUri: "",
    sponsorHmId,
    rankCode,
    password,
    creditBalance: 0,
    totalSelfSales: 0,
    totalTeamSales: 0,
    isVerified: isOffice,
    verified: isOffice,
    verifiedBy: isOffice ? (state.currentUser?.displayName || "Office") : "",
    verifiedAt: isOffice ? Date.now() : 0,
    isActive: true,
    active: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  try {
    await setDoc(doc(db, "health_mitras", hmCode), payload);
    closeModal();
    showToast(`Registered ${name} (${hmCode}) as ${rankCode}!`);
  } catch (e) {
    showToast("Registration failed: " + e.message);
  }
}

function openEditHmProfileModal(hmCode) {
  if (!state.currentUser?.canEditMedAndHm) {
    showToast("Only Sonali, Koushik & Super Admin have permission to update HM profiles.");
    return;
  }
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;

  openModal(`Update HM Profile & Password — ${hm.name} (${hm.hmCode})`, `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <div>
        <label class="font-bold text-slate-700">Full Name</label>
        <input id="updHmName" type="text" value="${escapeAttr(hm.name)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Mobile Number</label>
        <input id="updHmMobile" type="text" value="${escapeAttr(hm.mobileNo)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Rank / Designation</label>
        <select id="updHmRank" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-extrabold mt-1">
          ${MEMBER_RANK_OPTIONS.map(r => `
            <option value="${r.code}" ${normalizeRankCode(hm.rankCode) === r.code ? 'selected' : ''}>
              ${r.code} — ${r.title}
            </option>
          `).join("")}
        </select>
      </div>
      <div>
        <label class="font-bold text-slate-700">Upline Sponsor HM Code</label>
        <input id="updHmSponsor" type="text" value="${escapeAttr(hm.sponsorHmId)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold uppercase mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Login Password</label>
        <input id="updHmPass" type="text" value="${escapeAttr(hm.password || '123456')}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-extrabold mt-1 bg-amber-50/40" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Address / GP</label>
        <input id="updHmAddr" type="text" value="${escapeAttr(hm.hmAddress)}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div class="sm:col-span-2 flex items-center gap-2 pt-1">
        <input id="updHmVerified" type="checkbox" ${hm.isVerified ? 'checked' : ''} class="w-4 h-4" />
        <label for="updHmVerified" class="font-extrabold text-slate-800">Verified Health Mitra Account</label>
      </div>
    </div>
    <div class="pt-4 flex justify-end gap-2">
      <button onclick="window.ubApp.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">Cancel</button>
      <button onclick="window.ubApp.submitUpdateHmProfile('${escapeAttr(hm.hmCode)}')"
              class="px-5 py-2 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow">
        💾 Save Profile &amp; Password
      </button>
    </div>
  `);
}

async function submitUpdateHmProfile(hmCode) {
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;

  const name = document.getElementById("updHmName").value.trim() || hm.name;
  const mobileNo = document.getElementById("updHmMobile").value.trim() || hm.mobileNo;
  const rankCode = normalizeRankCode(document.getElementById("updHmRank").value);
  const sponsorHmId = document.getElementById("updHmSponsor").value.trim().toUpperCase();
  const password = document.getElementById("updHmPass").value.trim() || "123456";
  const hmAddress = document.getElementById("updHmAddr").value.trim();
  const isVerified = document.getElementById("updHmVerified").checked;

  const docId = hm.id || hm.hmCode;
  try {
    await setDoc(doc(db, "health_mitras", docId), {
      ...hm,
      name,
      mobileNo,
      rankCode,
      sponsorHmId,
      password,
      hmAddress,
      isVerified,
      verified: isVerified,
      updatedAt: Timestamp.now()
    }, { merge: true });
    closeModal();
    showToast(`Updated profile & password for ${name} (${hm.hmCode})!`);
  } catch (e) {
    showToast("Failed updating HM: " + e.message);
  }
}

function openPromoteModal(hmCode) {
  if (!state.currentUser?.isSuperAdmin) {
    showToast("Only Super Admin can promote Health Mitras.");
    return;
  }
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;
  const currentRank = normalizeRankCode(hm.rankCode);

  openModal(`🎖️ Super Admin: Promote ${hm.name} (${hm.hmCode})`, `
    <div class="space-y-3 text-xs">
      <div class="p-3 rounded-xl bg-amber-50 border border-amber-200 font-semibold text-amber-900">
        Current Rank / Designation: <b>${escapeHtml(currentRank)} — ${escapeHtml(getRankTitle(currentRank))}</b>
      </div>
      <div class="font-bold text-slate-700">Select New Rank or Designation to Promote To:</div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${PROMOTION_LADDER.map(code => {
          const opt = MEMBER_RANK_OPTIONS.find(o => o.code === code);
          return `
            <button onclick="window.ubApp.confirmPromoteHm('${escapeAttr(hm.hmCode)}', '${code}')"
                    class="p-2.5 rounded-xl border text-left transition ${
                      code === currentRank
                        ? 'ub-green-bg text-white border-emerald-900'
                        : 'bg-slate-50 hover:bg-amber-50 border-slate-300 text-slate-900'
                    }">
              <div class="font-black text-sm">${code}</div>
              <div class="text-[10px] opacity-80 font-semibold">${escapeHtml(opt?.title || code)}</div>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `);
}

async function confirmPromoteHm(hmCode, newRankCode) {
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;
  const docId = hm.id || hm.hmCode;
  try {
    await setDoc(doc(db, "health_mitras", docId), {
      rankCode: normalizeRankCode(newRankCode),
      updatedAt: Timestamp.now()
    }, { merge: true });
    closeModal();
    showToast(`Promoted ${hm.name} (${hm.hmCode}) to ${newRankCode}!`);
  } catch (e) {
    showToast("Promotion error: " + e.message);
  }
}

function openTreeMemberPaidModal(hmCode) {
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;
  const paidInvoices = getPaidInvoicesForHm(hm.hmCode);
  const totalPaid = paidInvoices.reduce((acc, b) => acc + Number(b.subtotal > 0 ? b.subtotal : b.netAmount), 0);
  const rankCode = normalizeRankCode(hm.rankCode);

  openModal(`${hm.name} (${hm.hmCode}) — Successful Paid Invoices`, `
    <div class="space-y-3 text-xs">
      <div class="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
        <div>
          <div class="text-slate-600 font-bold">${escapeHtml(hm.name)} • Rank: <b>${escapeHtml(rankCode)}</b></div>
          <div class="text-[11px] text-slate-500">Total Verified / Paid Invoices: <b>${paidInvoices.length}</b></div>
        </div>
        <div class="text-right">
          <div class="text-[10px] font-bold uppercase text-emerald-800">Successful Paid Total</div>
          <div class="text-xl font-black ub-green-text">₹${totalPaid.toFixed(0)}</div>
        </div>
      </div>

      ${paidInvoices.length === 0 ? `
        <div class="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
          No paid/verified invoices recorded for this member yet.
        </div>
      ` : `
        <div class="max-h-72 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-xl">
          ${paidInvoices.map(b => {
            const amt = Number(b.subtotal > 0 ? b.subtotal : b.netAmount).toFixed(0);
            const dStr = new Date(b.createdAtMs).toLocaleDateString("en-GB");
            return `
              <div class="p-2.5 flex items-center justify-between hover:bg-slate-50">
                <div>
                  <div class="font-extrabold text-slate-900">${escapeHtml(b.billNumber)} <span class="text-slate-500 font-semibold">(${dStr})</span></div>
                  <div class="text-[11px] text-slate-500">Mode: ${escapeHtml(b.paymentMode)} • Status: ${escapeHtml(b.status)}</div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-black ub-green-text text-sm">₹${amt}</span>
                  <button onclick="window.ubApp.downloadChallanPdf('${b.id}')"
                          class="px-2.5 py-1 rounded-lg ub-green-bg text-white font-bold text-[10px]">
                    PDF
                  </button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `}
    </div>
  `);
}

// ============================================================================
// 16. CHALLAN CREATION, VERIFICATION & OFFICIAL PDF GENERATOR (HM_NAME_DD-MM-YY.pdf)
// ============================================================================
function quickAddToBill(medId) {
  addMedToBill(medId);
  state.activeTab = "NEW_BILL";
  renderDashboard();
}

function addMedToBill(medId) {
  const allMeds = getMergedMedicines();
  const med = allMeds.find(m => m.id.toLowerCase() === String(medId).toLowerCase());
  if (!med) return;

  const isHm = state.currentUser?.type === "HM";
  const selectedHm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(state.billSelectedHmCode).toUpperCase());
  const targetRank = normalizeRankCode(selectedHm?.rankCode || (isHm ? state.currentUser.rankCode : "HM1"));
  const unitPrice = state.billMode === "WITH_RETAIL_PROFIT" ? med.patientPrice : getPriceForHmRank(med, targetRank);

  const existingIdx = state.billItems.findIndex(i => i.medicineId === med.id);
  if (existingIdx >= 0) {
    state.billItems[existingIdx].quantity += 1;
    state.billItems[existingIdx].unitPrice = unitPrice;
    state.billItems[existingIdx].totalAmount = state.billItems[existingIdx].quantity * unitPrice;
  } else {
    state.billItems.push({
      medicineId: med.id,
      slNo: med.slNo,
      medicineName: med.name,
      codeName: med.codeName,
      quantityNetContent: med.quantityNetContent,
      unitPrice,
      mrp: med.mrpPrice,
      quantity: 1,
      totalAmount: unitPrice
    });
  }
  showToast(`Added ${med.name} (₹${unitPrice})`);
  renderDashboard();
}

async function submitNewChallan() {
  if (state.billItems.length === 0) {
    showToast("Please add at least one medicine to generate a challan.");
    return;
  }
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(state.billSelectedHmCode).toUpperCase());
  if (!hm) {
    showToast("Please select a Health Mitra account first.");
    return;
  }

  const nextNum = state.bills.length + 73;
  const billNumber = `VD/${String(nextNum).padStart(5, "0")}`;
  const subtotal = state.billItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  const mrpTotal = state.billItems.reduce((acc, it) => acc + (it.mrp * it.quantity), 0);
  const discount = Math.max(0, mrpTotal - subtotal);

  let notes = "";
  if (state.billPaymentMode === "ONLINE") {
    const amt = state.billOnlineAmount || String(subtotal);
    notes = `ONLINE PAYMENT | Amount: ₹${amt} | Date: ${state.billOnlineDate} | Time: ${state.billOnlineTime}`;
  }

  const isOffice = state.currentUser?.type === "OFFICE";
  const billId = `bill_${Date.now()}`;
  const payload = {
    id: billId,
    billNumber,
    hmCode: hm.hmCode,
    hmName: hm.name,
    hmMobile: hm.mobileNo || "",
    hmAddress: hm.hmAddress || hm.gpName || "BELDA",
    gpName: hm.gpName || "",
    pincode: hm.pincode || "",
    branch: hm.branch || "Belda HQ",
    patientName: "",
    patientMobile: "",
    billingMode: state.billMode,
    paymentMode: state.billPaymentMode,
    items: state.billItems.map(it => ({
      medicineId: it.medicineId,
      medicineName: it.medicineName,
      quantityNetContent: it.quantityNetContent,
      unitPrice: Number(it.unitPrice),
      mrp: Number(it.mrp),
      quantity: Number(it.quantity),
      totalAmount: Number(it.unitPrice * it.quantity)
    })),
    subtotal: Number(subtotal),
    discount: Number(discount),
    netAmount: Number(subtotal),
    previousBalance: Number(hm.creditBalance || 0),
    currentBalance: Number(hm.creditBalance || 0),
    isChallanOnly: true,
    status: isOffice ? "PAID" : "PENDING",
    verifiedBy: isOffice ? (state.currentUser.displayName || "Office") : "",
    verifiedAt: isOffice ? Date.now() : 0,
    deliveredBy: "",
    deliveredAt: 0,
    stockDeducted: false,
    notes,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  try {
    await setDoc(doc(db, "bills", billId), payload);
    state.billItems = [];
    showToast(`Generated Challan ${billNumber} for ${hm.name}!`);
    state.activeTab = "ORDERS";
    renderDashboard();
  } catch (e) {
    showToast("Failed saving challan: " + e.message);
  }
}

async function verifyBillOrder(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return;
  try {
    await setDoc(doc(db, "bills", billId), {
      status: "PAID",
      verifiedBy: state.currentUser?.displayName || "Office",
      verifiedAt: Date.now(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast(`Verified Invoice ${b.billNumber}!`);
  } catch (e) {
    showToast("Error verifying bill: " + e.message);
  }
}

async function markOrderDelivered(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return;
  try {
    await setDoc(doc(db, "bills", billId), {
      status: "DELIVERED",
      deliveredBy: state.currentUser?.displayName || "Jeet",
      deliveredAt: Date.now(),
      stockDeducted: true,
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast(`Marked ${b.billNumber} Packed & Delivered!`);
  } catch (e) {
    showToast("Error updating delivery: " + e.message);
  }
}

function buildInvoiceFileName(bill) {
  const rawName = bill.hmName || bill.patientName || bill.billNumber || "CHALLAN";
  const cleanName = String(rawName)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .replace(/^_+|_+$/g, "") || "CHALLAN";
  const d = new Date(bill.createdAtMs || Date.now());
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${cleanName}_${dd}-${mm}-${yy}.pdf`;
}

function openChallanModal(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return;
  const dStr = new Date(b.createdAtMs).toLocaleDateString("en-GB");
  const fileName = buildInvoiceFileName(b);

  let totalHm = 0, totalMrp = 0;
  const rowsHtml = (b.items || []).map((it, idx) => {
    const rowHm = Number(it.unitPrice || 0) * Number(it.quantity || 1);
    const unitMrp = Number(it.mrp > 0 ? it.mrp : it.unitPrice);
    const rowMrp = unitMrp * Number(it.quantity || 1);
    totalHm += rowHm;
    totalMrp += rowMrp;
    return `
      <tr class="border-b border-slate-300 text-xs">
        <td class="py-1.5 px-2 text-center font-bold">${idx + 1}</td>
        <td class="py-1.5 px-2 font-extrabold">${escapeHtml(deriveCodeName(it.medicineName))}</td>
        <td class="py-1.5 px-2 text-center font-bold">${rowHm.toFixed(0)}</td>
        <td class="py-1.5 px-2 text-center">${it.quantity}</td>
        <td class="py-1.5 px-2 text-center font-bold">${rowMrp.toFixed(0)}</td>
      </tr>
    `;
  }).join("");

  openModal(`Stock Transfer Challan — ${b.billNumber}`, `
    <div class="border-2 border-slate-900 p-4 rounded-lg bg-white text-slate-900 space-y-2 text-xs">
      <div class="text-center space-y-0.5">
        <div class="text-sm font-black">UB AYURVED DRUGS &amp; PHARMACY</div>
        <div class="text-[11px]">BELDA, PASCHIM MEDINIPUR, WEST BENGAL, 721424</div>
        <div class="text-[10px]">Website : www.ubauyrved.co.in, E-mail- ayurvedub@gmail.com, Phone- 9382292173</div>
        <div class="text-[11px] font-bold">GSTIN : 19AOFPJ5320P1ZL</div>
        <div class="text-xs font-black pt-1">STOCK TRANSFER CHALLAN</div>
        <div class="text-[10px] font-bold">NOT TAX INVOICE • FOR DISPENSARY PURPOSE ONLY - NOT FOR RETAIL SALE</div>
      </div>

      <div class="flex justify-between pt-2 border-t border-slate-300 font-bold">
        <span>CHALLAN No- ${escapeHtml(b.billNumber)}</span>
        <span>Date : ${dStr}</span>
      </div>
      <div><b>From :</b> UB AYURVED DRUGS &amp; PHARMACY &nbsp;|&nbsp; <b>To :</b> Authorised Dispensary Center</div>
      <div class="flex justify-between font-bold">
        <span>Health Mitra Name: ${escapeHtml(String(b.hmName || '').toUpperCase())}</span>
        <span>Mitra Code : ${escapeHtml(b.hmCode || 'DIRECT')}</span>
      </div>
      <div><b>Address :</b> ${escapeHtml(String(b.hmAddress || 'BELDA').toUpperCase())} &nbsp;|&nbsp; <b>Mobile :-</b> ${escapeHtml(b.hmMobile || '')}</div>

      <table class="w-full border border-slate-800 mt-2">
        <thead>
          <tr class="bg-slate-100 border-b border-slate-800 text-[11px] font-extrabold">
            <th class="py-1 px-2">SL.NO.</th>
            <th class="py-1 px-2 text-left">Medicine Code</th>
            <th class="py-1 px-2">HM PRICE</th>
            <th class="py-1 px-2">Qty.</th>
            <th class="py-1 px-2">Price(Incl. all taxes)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="font-black bg-emerald-50 border-t border-slate-800">
            <td colspan="2" class="py-1.5 px-2">TOTAL AMOUNT</td>
            <td class="py-1.5 px-2 text-center">₹${Math.round(totalHm)}</td>
            <td></td>
            <td class="py-1.5 px-2 text-center">₹${Math.round(totalMrp)}</td>
          </tr>
        </tbody>
      </table>

      <div class="pt-1 font-bold">Received Amount :- ₹${Math.round(totalHm)}</div>
      ${b.notes ? `<div class="text-blue-800 font-extrabold">${escapeHtml(b.notes)}</div>` : ""}
      <div class="text-[10px] text-slate-500 pt-1">PDF File Name: <b>${escapeHtml(fileName)}</b></div>
    </div>

    <div class="pt-3 flex justify-end gap-2">
      <button onclick="window.ubApp.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">Close</button>
      <button onclick="window.ubApp.downloadChallanPdf('${b.id}')"
              class="px-5 py-2 rounded-xl ub-green-bg text-white font-extrabold text-xs shadow">
        📄 Download ${escapeHtml(fileName)}
      </button>
    </div>
  `);
}

function downloadChallanPdf(billId) {
  const bill = state.bills.find(x => x.id === billId);
  if (!bill || !window.jspdf) {
    showToast("PDF generator loading, please try again.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF({ unit: "pt", format: "a4" });

  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(13.5);
  docPdf.text("UB AYURVED DRUGS & PHARMACY", 297.5, 55, { align: "center" });

  docPdf.setFont("helvetica", "normal");
  docPdf.setFontSize(9);
  docPdf.text("BELDA, PASCHIM MEDINIPUR, WEST BENGAL, 721424", 297.5, 69, { align: "center" });
  docPdf.setFontSize(8.5);
  docPdf.text("Website : www.ubauyrved.co.in, E-mail- ayurvedub@gmail.com, Phone- 9382292173", 297.5, 82, { align: "center" });
  docPdf.setFontSize(9);
  docPdf.text("GSTIN : 19AOFPJ5320P1ZL", 297.5, 95, { align: "center" });

  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(13);
  docPdf.text("STOCK TRANSFER CHALLAN", 297.5, 112, { align: "center" });
  docPdf.setFontSize(9.5);
  docPdf.text("NOT TAX INVOICE", 297.5, 126, { align: "center" });
  docPdf.text("FOR DISPENSARY PURPOSE ONLY - NOT FOR RETAIL SALE", 297.5, 140, { align: "center" });

  const dStr = new Date(bill.createdAtMs).toLocaleDateString("en-GB");
  let y = 158;
  docPdf.setFontSize(9.5);
  docPdf.text(`CHALLAN No- ${bill.billNumber}`, 80, y);
  docPdf.text(`Date : ${dStr}`, 430, y);

  y += 20;
  docPdf.text("From : UB AYURVED DRUGS & PHARMACY", 80, y);
  y += 14;
  docPdf.text("To : Authorised Dispensary Center", 80, y);
  y += 14;
  docPdf.text(`Health Mitra Name: ${String(bill.hmName || "WALK-IN").toUpperCase()}`, 80, y);
  docPdf.text(`Mitra Code : ${bill.hmCode || "DIRECT"}`, 385, y);
  y += 14;
  docPdf.text(`Address :  ${String(bill.hmAddress || "BELDA").toUpperCase()}`, 80, y);
  y += 14;
  docPdf.text(`Mobile :- ${bill.hmMobile || ""}`, 80, y);

  y += 10;
  const colX = [80, 115, 225, 275, 340, 385, 430, 460, 515];
  docPdf.setLineWidth(0.8);
  docPdf.rect(80, y, 435, 24);
  for (let i = 1; i <= 7; i++) docPdf.line(colX[i], y, colX[i], y + 24);

  docPdf.setFontSize(8.2);
  docPdf.text("SL.NO.", 97.5, y + 15, { align: "center" });
  docPdf.text("Medicine Code", 170, y + 15, { align: "center" });
  docPdf.text("HM PRICE", 250, y + 15, { align: "center" });
  docPdf.text("Batch", 307.5, y + 15, { align: "center" });
  docPdf.text("Mfg.", 362.5, y + 15, { align: "center" });
  docPdf.text("Exp.", 407.5, y + 15, { align: "center" });
  docPdf.text("Qty.", 445, y + 15, { align: "center" });
  docPdf.text("Price(Incl.", 487.5, y + 10, { align: "center" });
  docPdf.text("all taxes)", 487.5, y + 19, { align: "center" });

  y += 24;
  const items = bill.items || [];
  const totalRows = Math.min(20, Math.max(10, items.length));
  let totalHm = 0, totalMrp = 0;

  for (let idx = 0; idx < totalRows; idx++) {
    docPdf.rect(80, y, 435, 15);
    for (let i = 1; i <= 7; i++) docPdf.line(colX[i], y, colX[i], y + 15);
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(8.8);
    docPdf.text(String(idx + 1), 97.5, y + 10.5, { align: "center" });

    if (idx < items.length) {
      const it = items[idx];
      const code = deriveCodeName(it.medicineName).toUpperCase().slice(0, 16);
      const rowHm = Number(it.unitPrice || 0) * Number(it.quantity || 1);
      const unitMrp = Number(it.mrp > 0 ? it.mrp : it.unitPrice);
      const rowMrp = unitMrp * Number(it.quantity || 1);
      totalHm += rowHm;
      totalMrp += rowMrp;

      docPdf.setFont("helvetica", "bold");
      docPdf.text(code, 170, y + 10.5, { align: "center" });
      docPdf.setFont("helvetica", "normal");
      docPdf.text(String(Math.round(rowHm)), 250, y + 10.5, { align: "center" });
      docPdf.text(String(it.quantity), 445, y + 10.5, { align: "center" });
      docPdf.text(String(Math.round(rowMrp)), 487.5, y + 10.5, { align: "center" });
    } else {
      docPdf.text("0", 487.5, y + 10.5, { align: "center" });
    }
    y += 15;
  }

  // TOTAL AMOUNT row
  docPdf.rect(80, y, 435, 16);
  for (let i = 2; i <= 7; i++) docPdf.line(colX[i], y, colX[i], y + 16);
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(9.5);
  docPdf.text("TOTAL AMOUNT", 84, y + 11.5);
  docPdf.text(String(Math.round(totalHm)), 250, y + 11.5, { align: "center" });
  docPdf.text(String(Math.round(totalMrp)), 487.5, y + 11.5, { align: "center" });

  y += 34;
  docPdf.text(`Received Amount :-   ${Math.round(totalHm)}`, 80, y);
  if (bill.notes) {
    y += 14;
    docPdf.setFontSize(8.5);
    docPdf.text(String(bill.notes), 80, y);
  }

  y += 22;
  docPdf.setFontSize(9.5);
  docPdf.text("Declaration :-", 80, y);
  docPdf.setFont("helvetica", "normal");
  docPdf.setFontSize(8);
  y += 13;
  docPdf.text("1. The Stock belongs to UB Ayurved Drugs & Pharmacy is Transferred for Dispensary Use.", 80, y);
  y += 12;
  docPdf.text("2. To be dispensed under supervision of UB Ayurved Chikitsalaya (Panel of BAMS Doctors).", 80, y);
  y += 12;
  docPdf.text("3. Any damage, breakage, leakage, or loss after receiving is the full responsibility of Health Mitra.", 80, y);
  y += 12;
  docPdf.text("4. Company will not replace damage medicine caused by Health Mitra's negligence.", 80, y);

  y += 32;
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(9);
  docPdf.text("For UB Ayurved Drugs & Pharmacy", 80, y);
  docPdf.text("Received by Health Mitra", 385, y);

  const fileName = buildInvoiceFileName(bill);
  docPdf.save(fileName);
  showToast(`Downloaded ${fileName}`);
}

// ============================================================================
// 17. INCENTIVE HELPERS & GLOBAL SAVE
// ============================================================================
async function selectRankIncentiveOption(hmCode, optionCode) {
  const clean = String(hmCode || "").toUpperCase();
  const currentOverrides = { ...(state.incentiveSettings.memberOverrides || {}) };
  currentOverrides[clean] = {
    ...(currentOverrides[clean] || { hmCode: clean }),
    hmCode: clean,
    selectedOption: optionCode,
    updatedBy: state.currentUser?.displayName || clean,
    updatedAt: Date.now()
  };
  state.incentiveSettings.memberOverrides = currentOverrides;
  await pushIncentiveSettingsToCloud();
  showToast(`Updated ${clean} incentive option to ${optionCode === 'OPTION_2_TEAM' ? 'Option 2: Team Business' : 'Option 1: Self Business'}`);
}

function openMemberIncentiveModal(hmCode) {
  const clean = String(hmCode || "").toUpperCase();
  const ov = state.incentiveSettings.memberOverrides?.[clean] || {};
  openModal(`⚙️ Super Admin: Manual Incentive % for ${clean}`, `
    <div class="space-y-3 text-xs">
      <div>
        <label class="font-bold text-slate-700">Custom Self Business % (leave blank for rank default)</label>
        <input id="custSelfPct" type="number" step="0.5" value="${ov.customSelfPct ?? ''}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div>
        <label class="font-bold text-slate-700">Custom Team Business % (leave blank for rank default)</label>
        <input id="custTeamPct" type="number" step="0.5" value="${ov.customTeamPct ?? ''}" class="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold mt-1" />
      </div>
      <div class="pt-3 flex justify-end gap-2">
        <button onclick="window.ubApp.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 font-bold">Cancel</button>
        <button onclick="window.ubApp.saveMemberIncentiveModal('${escapeAttr(clean)}')" class="px-5 py-2 rounded-xl ub-green-bg text-white font-extrabold">Save Override</button>
      </div>
    </div>
  `);
}

async function saveMemberIncentiveModal(hmCode) {
  const sVal = document.getElementById("custSelfPct").value.trim();
  const tVal = document.getElementById("custTeamPct").value.trim();
  const currentOverrides = { ...(state.incentiveSettings.memberOverrides || {}) };
  currentOverrides[hmCode] = {
    ...(currentOverrides[hmCode] || { hmCode, selectedOption: "OPTION_1_SELF" }),
    hmCode,
    customSelfPct: sVal !== "" ? Number(sVal) : null,
    customTeamPct: tVal !== "" ? Number(tVal) : null,
    updatedBy: state.currentUser?.displayName || "Super Admin",
    updatedAt: Date.now()
  };
  state.incentiveSettings.memberOverrides = currentOverrides;
  await pushIncentiveSettingsToCloud();
  closeModal();
  showToast(`Saved custom incentive override for ${hmCode}!`);
}

async function saveGlobalIncentives() {
  const ranks = ["HM", "MR", "SR", "SE", "SO", "TSM", "ASM", "RSM"];
  const selfMap = {};
  const teamMap = {};
  for (const r of ranks) {
    selfMap[r] = Number(document.getElementById(`selfPct_${r}`)?.value ?? 5);
    teamMap[r] = Number(document.getElementById(`teamPct_${r}`)?.value ?? 0);
  }
  state.incentiveSettings.hmManualPct = selfMap.HM;
  state.incentiveSettings.rankSelfPctMap = selfMap;
  state.incentiveSettings.rankTeamPctMap = teamMap;
  state.incentiveSettings.updatedBy = state.currentUser?.displayName || "Super Admin";
  state.incentiveSettings.updatedAt = Date.now();
  await pushIncentiveSettingsToCloud();
  showToast("Saved Global Incentive Percentages to Cloud!");
}

async function pushIncentiveSettingsToCloud() {
  try {
    await setDoc(doc(db, "commission_config", "incentive_rules_v2"), {
      jsonPayload: JSON.stringify(state.incentiveSettings),
      updatedBy: state.currentUser?.displayName || "Admin",
      updatedAt: Date.now()
    });
  } catch (e) {
    showToast("Failed syncing incentive settings: " + e.message);
  }
}

async function verifyHm(hmCode) {
  const hm = state.healthMitras.find(h => String(h.hmCode).toUpperCase() === String(hmCode).toUpperCase());
  if (!hm) return;
  try {
    await setDoc(doc(db, "health_mitras", hm.id || hm.hmCode), {
      isVerified: true,
      verified: true,
      verifiedBy: state.currentUser?.displayName || "Office",
      verifiedAt: Date.now(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    showToast(`Verified ${hm.name} (${hm.hmCode})!`);
  } catch (e) {
    showToast("Failed verifying HM: " + e.message);
  }
}

// ============================================================================
// 18. UTILITIES & GLOBAL WINDOW BINDINGS
// ============================================================================
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

window.ubApp = {
  sendOfficeOtp,
  verifyOfficeOtp,
  loginHm,
  loginHm,
  logout,
  setTab(tabId) {
    state.activeTab = tabId;
    renderDashboard();
  },
  updatePriceSearch(val) {
    state.priceSearch = val;
    renderActiveTabBody();
  },
  updatePriceCategory(val) {
    state.priceCategory = val;
    renderActiveTabBody();
  },
  updateHmSearch(val) {
    state.hmSearch = val;
    renderActiveTabBody();
  },
  updateOrdersSearch(val) {
    state.ordersSearch = val;
    renderActiveTabBody();
  },
  selectBillHm(val) {
    state.billSelectedHmCode = val;
    renderActiveTabBody();
  },
  selectBillMode(val) {
    state.billMode = val;
    renderActiveTabBody();
  },
  updateBillMedSearch(val) {
    state.billMedSearch = val;
    renderActiveTabBody();
  },
  setBillPaymentMode(pm) {
    state.billPaymentMode = pm;
    renderActiveTabBody();
  },
  setOnlineField(field, val) {
    if (field === "amount") state.billOnlineAmount = val;
    if (field === "date") state.billOnlineDate = val;
    if (field === "time") state.billOnlineTime = val;
  },
  changeBillItemQty(idx, delta) {
    const item = state.billItems[idx];
    if (!item) return;
    item.quantity = Math.max(1, item.quantity + delta);
    item.totalAmount = item.quantity * item.unitPrice;
    renderActiveTabBody();
  },
  removeBillItem(idx) {
    state.billItems.splice(idx, 1);
    renderActiveTabBody();
  },
  setTreeRootHm(val) {
    state.treeRootHmCode = val;
    renderActiveTabBody();
  },
  quickAddToBill,
  addMedToBill,
  submitNewChallan,
  verifyBillOrder,
  markOrderDelivered,
  openChallanModal,
  downloadChallanPdf,
  openEditMedicineModal,
  saveMedicinePriceOverride,
  openRegisterHmModal,
  submitRegisterHm,
  openEditHmProfileModal,
  submitUpdateHmProfile,
  openPromoteModal,
  confirmPromoteHm,
  openTreeMemberPaidModal,
  selectRankIncentiveOption,
  openMemberIncentiveModal,
  saveMemberIncentiveModal,
  saveGlobalIncentives,
  verifyHm,
  closeModal
};

// Firestore listeners start only after Firebase Auth and the UID-bound
// Office profile are validated. Never restore a role object from localStorage.
observeFirebaseAuth(async (user) => {
  if (!user) {
    state.currentUser = null;
    document.getElementById("dashboardView")?.classList.add("hidden");
    document.getElementById("headerUserControls")?.classList.add("hidden");
    document.getElementById("loginView")?.classList.remove("hidden");
    return;
  }
  try {
    await applyAuthorizedOfficeUser(user);
  } catch (error) {
    showLoginError(error?.message || "Office authorization failed.");
    await signOutFirebase();
  }
});
