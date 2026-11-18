import { readFileSync } from "node:fs";
import { before, after, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, deleteDoc } from "firebase/firestore";

const projectId = "ub-ayurved-rules-test";
const rules = readFileSync("firestore.rules", "utf8");
let testEnv;

const staffClaims = { phone_number: "+919000000001" };
const adminClaims = { phone_number: "+919000000002" };

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
      active: true, displayName: "Test Staff"
    });
    await setDoc(doc(db, "office_staff_auth/admin-1"), {
      uid: "admin-1", phoneE164: adminClaims.phone_number,
      staffRole: "SUPER_ADMIN", officeCategory: "SUPER_ADMIN",
      active: true, displayName: "Test Admin"
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
    await setDoc(doc(db, "bills/bill-1"), { total: 100 });
  });
});

function staffDb() {
  return testEnv.authenticatedContext("staff-1", staffClaims).firestore();
}
function adminDb() {
  return testEnv.authenticatedContext("admin-1", adminClaims).firestore();
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

test("admin can read medicines", async () => {
  await assertSucceeds(getDoc(doc(adminDb(), "medicines/med-1")));
});

test("only approved medicine editors and admins can write medicine records", async () => {
  const medicine = {
    slNo: 2, name: "New Medicine", codeName: "NEW",
    quantityNetContent: "1 bottle", mrpPrice: 120, hmPrice: 95,
    patientPrice: 110, stockQuantity: 4, lowStockThreshold: 1,
    status: "IN_STOCK", updatedAt: new Date()
  };
  await assertSucceeds(setDoc(doc(staffDb(), "medicines/new-med"), medicine));
  await assertSucceeds(setDoc(doc(adminDb(), "medicines/admin-med"), medicine));
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

test("bills remain denied until their role matrix is implemented", async () => {
  await assertFails(getDoc(doc(staffDb(), "bills/bill-1")));
  await assertFails(getDoc(doc(adminDb(), "bills/bill-1")));
});