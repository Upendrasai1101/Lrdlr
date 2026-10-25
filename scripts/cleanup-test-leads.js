#!/usr/bin/env node
// cleanup-test-leads.js
// Deletes leads added while testing (origin "web" / "csv_upload") and keeps
// the 37 legacy leads (origin "legacy_import").
//   npm run cleanup                 -> dry run, only lists
//   npm run cleanup -- --confirm    -> really deletes

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const KEY_PATH = path.join(__dirname, "..", "service-account-key.json");
const KEEP_ORIGIN = "legacy_import";
const CONFIRM = process.argv.includes("--confirm");

if (!fs.existsSync(KEY_PATH)) {
  console.error("service-account-key.json not found in the project root. Nothing was changed.");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

async function main() {
  const snap = await db.collection("leads").get();
  const keep = [];
  const remove = [];
  snap.docs.forEach((d) => (d.data().origin === KEEP_ORIGIN ? keep : remove).push(d));

  console.log(`Leads in Firestore: ${snap.size}`);
  console.log(`Keep (legacy import): ${keep.length}`);
  console.log(`Test leads to delete: ${remove.length}\n`);
  remove.forEach((d) => {
    const l = d.data();
    console.log(`  - ${l.name}  ${l.phone}  ${l.pincode}  [${l.origin}]  id=${d.id}`);
  });

  if (keep.length !== 37) console.log(`\n[warning] Expected 37 legacy leads, found ${keep.length}.`);

  if (!CONFIRM) {
    console.log("\nDry run only - nothing deleted. To delete, run:  npm run cleanup -- --confirm");
    return;
  }
  if (remove.length === 0) return console.log("\nNothing to delete.");

  for (let i = 0; i < remove.length; i += 400) {
    const batch = db.batch();
    remove.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const after = await db.collection("leads").get();
  const newCount = after.docs.filter((d) => d.data().status === "New").length;
  console.log(`\nDeleted ${remove.length}. Leads now: ${after.size} (New: ${newCount}).`);
}

main().catch((err) => {
  console.error("cleanup failed:", err.message);
  process.exit(1);
});