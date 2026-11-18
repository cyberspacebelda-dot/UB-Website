import { readFileSync } from "node:fs";
import { before, after, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, deleteDoc } from "firebase/firestore";

const projectId = "ub-ayurved-rules-test";
const rules = readFileSync("firestore.rules", "utf8");
let testEnv;

const staffClaims = { phone_number: "+919000000001" };
const adminClaims = { phone_number: "+919000000002" };
const gopalClaims = { phone_number: "+919000000004" };
const milanClaims = { phone_number: "+919000000005" };
const deliveryClaims = { phone_number: "+919000000006" };

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "office_staff_auth/staff-1"), {
      uid: "staff-1", phoneE164: staffClaims.phone_number,
      staffRole: "STAFF_SONALI", officeCategory: "BILLING_STAFF",
      active: true, displayName: "Test Billing Staff"
    });
    await setDoc(doc(db, "office_staff_auth/admin-1"), {
      uid: "admin-1", phoneE164: adminClaims.phone_number,
      staffRole: "SUPER_ADMIN", officeCategory: "SUPER_ADMIN",
      active: true, displayName: "Test Super Admin"
    });
    await setDoc(doc(db, "office_staff_auth/gopal-1"), {
      uid: "gopal-1", phoneE164: gopalClaims.phone_number,
      staffRole: "ADMIN_GOPAL", officeCategory: "BILLING_PRODUCTION_VIEWER",
      active: true, displayName: "Test Gopal"
    });
    await setDoc(doc(db, "office_staff_auth/milan-1"), {
      uid: "milan-1", phoneE164: milanClaims.phone_number,
      staffRole: "ADMIN_MILAN", officeCategory: "BILLING_PRODUCTION_VIEWER",
      active: true, displayName: "Test Milan"
    });
    await setDoc(doc(db, "office_staff_auth/jeet-1"), {
      uid: "jeet-1", phoneE164: deliveryClaims.phone_number,
      staffRole: "STAFF_JEET", officeCategory: "DELIVERY_STAFF",
      active: true, displayName: "Test Delivery Staff"
    });
    await setDoc(doc(db, "office_staff_auth/inactive-1"), {
      uid: "inactive-1", phoneE164: "+919000000003",
      staffRole: "STAFF_JEET", officeCategory: "DELIVERY_STAFF",
      active: false, displayName: "Inactive Staff"
    });
    await setDoc(doc(db, "medicines/med-1"), {
      slNo: 1, name: "Test Medicine", codeName: "TEST",
      quantityNetContent: "10 tablets", mrpPrice: 100, hmPrice: 80,
      patientPrice: 90, stockQuantity: 5, lowStockThreshold: 2,
      status: "IN_STOCK", updatedAt: new Date()
    });
    await setDoc(doc(db, "inventory_logs/log-1"), {
      medicineId: "med-1", medicineName: "Test Medicine",
      action: "STOCK_IN", createdByUid: "staff-1", createdAt: new Date()
    });
    await setDoc(doc(db, "bills/bill-1"), {
      billNumber: "VD/00001", hmCode: "HM001", hmName: "Test HM",
      hmMobile: "9000000000", hmAddress: "Belda", gpName: "Belda",
      pincode: "721424", branch: "Belda HQ", patientName: "",
      patientMobile: "", billingMode: "DISPENSARY_CHALLAN",
      paymentMode: "CASH", items: [{ medicineId: "med-1", quantity: 1 }],
      subtotal: 80, discount: 20, netAmount: 80, previousBalance: 0,
      currentBalance: 0, isChallanOnly: true, status: "PENDING",
      verifiedBy: "", verifiedAt: 0, deliveredBy: "", deliveredAt: 0,
      stockDeducted: false, notes: "",
      createdAt: new Date(), updatedAt: new Date()
    });
    await setDoc(doc(db, "commission_config/medicine_price_list_2026"), {
      jsonPayload: "[]", updatedBy: "test", updatedAt: Date.now()
    });
    await setDoc(doc(db, "commission_config/incentive_rules_v2"), {
      jsonPayload: "{}", updatedBy: "test", updatedAt: Date.now()
    });
  });
});

function staffDb() {
  return testEnv.authenticatedContext("staff-1", staffClaims).firestore();
}
function adminDb() {
  return testEnv.authenticatedContext("admin-1", adminClaims).firestore();
}
function gopalDb() {
  return testEnv.authenticatedContext("gopal-1", gopalClaims).firestore();
}
function milanDb() {
  return testEnv.authenticatedContext("milan-1", milanClaims).firestore();
}
function jeetDb() {
  return testEnv.authenticatedContext("jeet-1", deliveryClaims).firestore();
}

test("approved active staff can read medicine documents and list catalogue", async () => {
  const db = staffDb();
  await assertSucceeds(getDoc(doc(db, "medicines/med-1")));
  await assertSucceeds(getDocs(collection(db, "medicines")));
});

test("unauthenticated users cannot read medicines", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "medicines/med-1")));
  await assertFails(getDocs(collection(db, "medicines")));
});

test("authenticated but unenrolled users cannot read medicines", async () => {
  const db = testEnv.authenticatedContext("unknown-user", {
    phone_number: "+919000000009"
  }).firestore();
  await assertFails(getDoc(doc(db, "medicines/med-1")));
});

test("inactive office profile cannot read medicines", async () => {
  const db = testEnv.authenticatedContext("inactive-1", {
    phone_number: "+919000000003"
  }).firestore();
  await assertFails(getDoc(doc(db, "medicines/med-1")));
});

test("Super Admin can read medicines", async () => {
  await assertSucceeds(getDoc(doc(adminDb(), "medicines/med-1")));
});

test("Gopal and Milan are read-only for medicines and stock records", async () => {
  for (const db of [gopalDb(), milanDb()]) {
    await assertSucceeds(getDoc(doc(db, "medicines/med-1")));
    await assertSucceeds(getDoc(doc(db, "inventory_logs/log-1")));
    await assertFails(updateDoc(doc(db, "medicines/med-1"), { stockQuantity: 9, updatedAt: new Date() }));
    await assertFails(setDoc(doc(db, "inventory_logs/viewer-write"), {
      medicineId: "med-1", medicineName: "Test Medicine",
      action: "STOCK_OUT", createdByUid: "gopal-1", createdAt: new Date()
    }));
    await assertSucceeds(getDoc(doc(db, "bills/bill-1")));
  }
});

test("only approved medicine editors and Super Admin can write medicine records", async () => {
  const medicine = {
    slNo: 2, name: "New Medicine", codeName: "NEW",
    quantityNetContent: "1 bottle", mrpPrice: 120, hmPrice: 95,
    patientPrice: 110, stockQuantity: 4, lowStockThreshold: 1,
    status: "IN_STOCK", updatedAt: new Date()
  };
  await assertSucceeds(setDoc(doc(staffDb(), "medicines/new-med"), medicine));
  await assertSucceeds(setDoc(doc(adminDb(), "medicines/admin-med"), medicine));
  await assertFails(setDoc(doc(jeetDb(), "medicines/delivery-blocked"), medicine));
  await assertFails(setDoc(doc(gopalDb(), "medicines/viewer-blocked"), medicine));
  const ordinaryDb = testEnv.authenticatedContext("unknown-user", {
    phone_number: "+919000000009"
  }).firestore();
  await assertFails(setDoc(doc(ordinaryDb, "medicines/blocked-med"), medicine));
});

test("staff can read and append inventory logs", async () => {
  const db = staffDb();
  await assertSucceeds(getDoc(doc(db, "inventory_logs/log-1")));
  await assertSucceeds(getDocs(collection(db, "inventory_logs")));
  await assertSucceeds(setDoc(doc(db, "inventory_logs/log-2"), {
    medicineId: "med-1", medicineName: "Test Medicine",
    action: "STOCK_OUT", createdByUid: "staff-1", createdAt: new Date()
  }));
});

test("delivery staff can append stock movement logs but cannot change medicine records", async () => {
  await assertSucceeds(setDoc(doc(jeetDb(), "inventory_logs/jeet-log"), {
    medicineId: "med-1", medicineName: "Test Medicine",
    action: "STOCK_OUT", createdByUid: "jeet-1", createdAt: new Date()
  }));
  await assertFails(updateDoc(doc(jeetDb(), "medicines/med-1"), {
    stockQuantity: 0, updatedAt: new Date()
  }));
});

test("inventory log author cannot be spoofed", async () => {
  const db = staffDb();
  await assertFails(setDoc(doc(db, "inventory_logs/log-spoof"), {
    medicineId: "med-1", medicineName: "Test Medicine",
    action: "STOCK_OUT", createdByUid: "another-user", createdAt: new Date()
  }));
});

test("inventory logs are immutable after creation", async () => {
  const db = staffDb();
  await assertFails(updateDoc(doc(db, "inventory_logs/log-1"), { note: "tampered" }));
  await assertFails(deleteDoc(doc(db, "inventory_logs/log-1")));
});

test("unenrolled users cannot read or append inventory logs", async () => {
  const db = testEnv.authenticatedContext("unknown-user", {
    phone_number: "+919000000009"
  }).firestore();
  await assertFails(getDoc(doc(db, "inventory_logs/log-1")));
  await assertFails(setDoc(doc(db, "inventory_logs/blocked"), {
    medicineId: "med-1", medicineName: "Test Medicine",
    action: "STOCK_IN", createdByUid: "unknown-user", createdAt: new Date()
  }));
});

test("client cannot create or modify office authorization profiles", async () => {
  const db = staffDb();
  await assertFails(setDoc(doc(db, "office_staff_auth/attacker"), {
    uid: "attacker", phoneE164: "+919000000009",
    staffRole: "SUPER_ADMIN", officeCategory: "SUPER_ADMIN",
    active: true, displayName: "Attacker"
  }));
});

test("billing staff may update medicine price configuration but not incentive settings", async () => {
  await assertSucceeds(setDoc(doc(staffDb(), "commission_config/medicine_price_list_2026"), {
    jsonPayload: "[]", updatedBy: "Test Billing Staff", updatedAt: Date.now()
  }));
  await assertFails(setDoc(doc(staffDb(), "commission_config/incentive_rules_v2"), {
    jsonPayload: "{\"rankSelfPctMap\":{}}", updatedBy: "Test Billing Staff", updatedAt: Date.now()
  }));
});

test("only Super Admin can read and update incentive configuration", async () => {
  await assertSucceeds(getDoc(doc(adminDb(), "commission_config/incentive_rules_v2")));
  await assertSucceeds(setDoc(doc(adminDb(), "commission_config/incentive_rules_v2"), {
    jsonPayload: "{}", updatedBy: "Test Super Admin", updatedAt: Date.now()
  }));
  await assertFails(getDoc(doc(gopalDb(), "commission_config/incentive_rules_v2")));
  await assertFails(getDoc(doc(staffDb(), "commission_config/incentive_rules_v2")));
});

test("billing staff can create bills and verify payment without deleting records", async () => {
  const db = staffDb();
  const bill = {
    billNumber: "VD/00002", hmCode: "HM002", hmName: "New HM",
    hmMobile: "9000000001", hmAddress: "Belda", gpName: "Belda",
    pincode: "721424", branch: "Belda HQ", patientName: "",
    patientMobile: "", billingMode: "DISPENSARY_CHALLAN",
    paymentMode: "CASH", items: [{ medicineId: "med-1", quantity: 1 }],
    subtotal: 80, discount: 20, netAmount: 80, previousBalance: 0,
    currentBalance: 0, isChallanOnly: true, status: "PAID",
    verifiedBy: "Test Billing Staff", verifiedAt: Date.now(),
    deliveredBy: "", deliveredAt: 0, stockDeducted: false, notes: "",
    createdAt: new Date(), updatedAt: new Date()
  };
  await assertSucceeds(setDoc(doc(db, "bills/new-bill"), bill));
  await assertSucceeds(updateDoc(doc(db, "bills/bill-1"), {
    status: "PAID", verifiedBy: "Test Billing Staff",
    verifiedAt: Date.now(), updatedAt: new Date()
  }));
  await assertFails(deleteDoc(doc(db, "bills/bill-1")));
});

test("view-only admins can read bills but cannot create or modify them", async () => {
  for (const db of [gopalDb(), milanDb()]) {
    await assertSucceeds(getDoc(doc(db, "bills/bill-1")));
    await assertFails(updateDoc(doc(db, "bills/bill-1"), {
      status: "PAID", verifiedBy: "Viewer", verifiedAt: Date.now(), updatedAt: new Date()
    }));
    await assertFails(deleteDoc(doc(db, "bills/bill-1")));
  }
});

test("billing staff can append validated online payment metadata to bills", async () => {
  await assertSucceeds(updateDoc(doc(staffDb(), "bills/bill-1"), {
    notes: "ONLINE PAYMENT | Amount: ₹80 | Date: 18-11-2026 | Time: 11:00",
    onlinePaymentAmount: "80",
    onlinePaymentDate: "18-11-2026",
    onlinePaymentTime: "11:00"
  }));
  await assertFails(updateDoc(doc(jeetDb(), "bills/bill-1"), {
    notes: "tampered", onlinePaymentAmount: "80",
    onlinePaymentDate: "18-11-2026", onlinePaymentTime: "11:00"
  }));
});

test("delivery staff can update only delivery fields on bills", async () => {
  const db = jeetDb();
  await assertSucceeds(getDoc(doc(db, "bills/bill-1")));
  await assertSucceeds(updateDoc(doc(db, "bills/bill-1"), {
    status: "DELIVERED", deliveredBy: "Test Delivery Staff",
    deliveredAt: Date.now(), stockDeducted: true, updatedAt: new Date()
  }));
  await assertFails(updateDoc(doc(db, "bills/bill-1"), {
    status: "PAID", verifiedBy: "Test Delivery Staff",
    verifiedAt: Date.now(), updatedAt: new Date()
  }));
  await assertFails(deleteDoc(doc(db, "bills/bill-1")));
});

test("ledger is read-only for Super Admin and Billing Staff", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "ledger/entry-1"), {
      hmCode: "HM001", balance: 100, createdAt: new Date()
    });
  });
  await assertSucceeds(getDoc(doc(adminDb(), "ledger/entry-1")));
  await assertSucceeds(getDoc(doc(staffDb(), "ledger/entry-1")));
  await assertFails(getDoc(doc(gopalDb(), "ledger/entry-1")));
  await assertFails(getDoc(doc(jeetDb(), "ledger/entry-1")));
  await assertFails(updateDoc(doc(staffDb(), "ledger/entry-1"), { balance: 0 }));
  await assertFails(deleteDoc(doc(adminDb(), "ledger/entry-1")));
});

test("Health Mitra and Returns collections remain closed until secure identity and schema migration", async () => {
  for (const db of [staffDb(), adminDb(), gopalDb(), milanDb(), jeetDb()]) {
    await assertFails(getDoc(doc(db, "health_mitras/HM001")));
    await assertFails(getDoc(doc(db, "returns/return-1")));
    await assertFails(setDoc(doc(db, "returns/return-2"), { hmCode: "HM001" }));
    await assertFails(deleteDoc(doc(db, "bills/bill-1")));
    await assertFails(deleteDoc(doc(db, "returns/return-1")));
  }
});
