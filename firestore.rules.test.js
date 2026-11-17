import { readFileSync } from "node:fs";
import { before, after, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";

const projectId = "ub-ayurved-rules-test";
const rules = readFileSync("firestore.rules", "utf8");
let testEnv;

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
    await setDoc(doc(ctx.firestore(), "office_staff_auth/phone-user-1"), {
      uid: "phone-user-1",
      phoneE164: "+919000000001",
      staffRole: "STAFF_SONALI",
      officeCategory: "BILLING_STAFF",
      active: true,
      displayName: "Test Staff"
    });
    await setDoc(doc(ctx.firestore(), "bills/test-bill"), { total: 100 });
    await setDoc(doc(ctx.firestore(), "health_mitras/HM001"), { password: "never-expose" });
  });
});

test("verified user can read only their own active office profile", async () => {
  const db = testEnv.authenticatedContext("phone-user-1", {
    phone_number: "+919000000001"
  }).firestore();
  await assertSucceeds(getDoc(doc(db, "office_staff_auth/phone-user-1")));
});

test("user cannot read another staff profile", async () => {
  const db = testEnv.authenticatedContext("attacker", {
    phone_number: "+919000000009"
  }).firestore();
  await assertFails(getDoc(doc(db, "office_staff_auth/phone-user-1")));
});

test("client cannot create or modify office role profiles", async () => {
  const db = testEnv.authenticatedContext("phone-user-1", {
    phone_number: "+919000000001"
  }).firestore();
  await assertFails(setDoc(doc(db, "office_staff_auth/attacker"), {
    uid: "attacker", phoneE164: "+919000000009", role: "SUPER_ADMIN",
    category: "SUPER_ADMIN", active: true, displayName: "Attacker"
  }));
});

test("unauthenticated and authenticated users cannot read bills or HM records", async () => {
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const signedInDb = testEnv.authenticatedContext("phone-user-1", {
    phone_number: "+919000000001"
  }).firestore();
  await assertFails(getDoc(doc(anonymousDb, "bills/test-bill")));
  await assertFails(getDoc(doc(signedInDb, "health_mitras/HM001")));
});

test("public medicine catalogue read remains available", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(db, "medicines")));
});

test("only trusted officeAdmin custom claim can write medicines", async () => {
  const ordinaryDb = testEnv.authenticatedContext("staff", {
    phone_number: "+919000000001"
  }).firestore();
  const adminDb = testEnv.authenticatedContext("admin", {
    officeAdmin: true
  }).firestore();
  const medicine = {
    slNo: 1, name: "Test", codeName: "TEST", quantityNetContent: "1 unit",
    mrpPrice: 10, hmPrice: 8, patientPrice: 9, stockQuantity: 1,
    lowStockThreshold: 0, status: "AVAILABLE",
    createdAt: new Date(), updatedAt: new Date()
  };
  await assertFails(setDoc(doc(ordinaryDb, "medicines/test"), medicine));
  await assertSucceeds(setDoc(doc(adminDb, "medicines/test"), medicine));
});
