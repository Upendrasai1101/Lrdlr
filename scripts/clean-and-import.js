#!/usr/bin/env node
/**
 * clean-and-import.js
 *
 * LRDLR (Lead Router for Dealers) - legacy data cleanup and import.
 * All data in data/ is fictional demo data. What this script does:
 *
 *   1. Reads data/dealers.csv and data/legacy_leads.csv.
 *   2. Cleans every row of legacy_leads.csv (see cleanRow() below for every
 *      specific problem and how it's handled - matches README.md
 *      "Data problems in legacy_leads.csv").
 *   3. Figures out which dealer each surviving lead belongs to, using the
 *      exact same pincode-prefix rule as the website (public/dealer-assign.js).
 *   4. Keeps EVERY valid row, including repeat enquiries from the same phone
 *      number. A repeat is imported as its own lead and flagged (is_repeat,
 *      repeat_of, enquiry_number), never skipped. Only rows that are truly
 *      unusable (no name, bad phone, bad pincode, bad date, bad status) are
 *      rejected.
 *   5. Writes everything (dealers + cleaned leads) into Firestore, IF a
 *      service-account-key.json is present. If it isn't (e.g. you're just
 *      testing the cleaning logic before setting up a Firebase project),
 *      the script still runs and still writes the report - it just skips
 *      the Firestore part and tells you so.
 *   6. Writes reports/reconciliation.csv with one row per ORIGINAL input
 *      row, recording exactly what happened to it: lead_id, action, reason.
 *
 * Run it with:  npm run clean-and-import
 * (or directly: node scripts/clean-and-import.js)
 *
 * Safe test run, never touches Firestore:  node scripts/clean-and-import.js --dry-run
 *
 * Re-running against a database that already has leads is safe: leads that
 * already exist are left exactly as they are (so a status someone changed on
 * the dashboard is not reset). Only leads that are missing get created.
 */

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORTS_DIR = path.join(__dirname, "..", "reports");
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "..", "service-account-key.json");

const DEALERS_CSV = path.join(DATA_DIR, "dealers.csv");
const LEADS_CSV = path.join(DATA_DIR, "legacy_leads.csv");

const VALID_STATUSES = ["New", "Contacted", "Converted", "Lost"];

// ---------------------------------------------------------------------
// Small, independently-testable helpers
// ---------------------------------------------------------------------

/** Same phone-cleaning rule as public/validate.js normalizePhone(), kept
 * duplicated on purpose: this is a plain Node.js script with no build
 * step, and the browser code is loaded as native ES module imports from
 * a CDN, so sharing one file between the two isn't simple to set up for
 * a project this size. The RULE is identical; if you change one, change
 * the other. */
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10) return null;
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

function isValidPincode(raw) {
  return /^\d{6}$/.test(String(raw).trim());
}

function titleCase(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Days in a given month/year, used to fix impossible dates like
 * "31/09/2026" (September only has 30 days). */
function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

/**
 * Parses the two date formats seen in the source data:
 *   - "YYYY-MM-DD" (the normal format, used by almost every row)
 *   - "DD/MM/YYYY" (seen once, and with an impossible day-of-month)
 * Returns { iso, wasFixed } where iso is a valid "YYYY-MM-DD" string.
 * If the day doesn't exist in that month, clamps it down to the last
 * valid day of that month and reports wasFixed = true.
 */
function cleanDate(raw) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const maxDay = daysInMonth(month, year);
    if (day > maxDay) {
      const fixedIso = `${year}-${String(month).padStart(2, "0")}-${String(maxDay).padStart(2, "0")}`;
      return { iso: fixedIso, wasFixed: true, detail: `${raw} is not a real date (month ${month} only has ${maxDay} days); corrected to ${fixedIso}` };
    }
    return { iso: raw.trim(), wasFixed: false };
  }

  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const maxDay = daysInMonth(month, year);
    const clampedDay = Math.min(day, maxDay);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
    const wasFixed = clampedDay !== day;
    return {
      iso,
      wasFixed: true, // format itself needed converting, so always "fixed"
      detail: wasFixed
        ? `${raw} is not a real date (month ${month} only has ${maxDay} days); corrected to ${iso}`
        : `${raw} was in DD/MM/YYYY format; converted to ${iso}`,
    };
  }

  // Unrecognized format entirely - leave as-is, caller will treat as unfixable.
  return { iso: null, wasFixed: false, detail: `unrecognized date format: "${raw}"` };
}

function assignDealer(pincode, dealers) {
  const prefix = String(pincode).slice(0, 3);
  const match = dealers.find((d) => d.pincode_prefixes.includes(prefix));
  if (match) return { dealer_id: match.dealer_id, dealer_name: match.dealer_name };
  return { dealer_id: "INHOUSE", dealer_name: "In-house Sales" };
}

// ---------------------------------------------------------------------
// Loading source CSVs
// ---------------------------------------------------------------------

function loadDealers() {
  const raw = fs.readFileSync(DEALERS_CSV, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  return rows.map((r) => ({
    dealer_id: r.dealer_id,
    dealer_name: r.dealer_name,
    city: r.city,
    pincode_prefixes: r.pincode_prefixes.split("|").map((p) => p.trim()),
    contact_email: r.contact_email,
  }));
}

function loadLegacyLeads() {
  const raw = fs.readFileSync(LEADS_CSV, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true });
}

// ---------------------------------------------------------------------
// Row-by-row cleaning
// ---------------------------------------------------------------------

/**
 * Cleans one row of legacy_leads.csv.
 *
 * `seenPhones` is a Map<normalizedPhone, { firstId, count }>, carried across
 * calls so we can recognise "this customer already has a lead" (in the demo
 * data: L1003/L1036, L1007/L1039, L1010/L1037, L1031/L1038, L1013/L1033).
 * The PHONE NUMBER identifies a customer, but a repeat is NOT dropped: it is
 * imported as its own lead, flagged as a repeat of the first one, so no
 * enquiry is lost.
 *
 * `seenLeadIds` is a Set<lead_id>, used to catch the separate problem of
 * the SAME lead_id being reused for two different rows (L1033 appears twice:
 * the second one is really a repeat of L1013, but we guard against an ID
 * collision in general in case the data has one we haven't spotted).
 */
function cleanRow(row, dealers, seenPhones, seenLeadIds) {
  const originalLeadId = row.lead_id;
  const issues = []; // human-readable notes, newest problem last
  let fixedSomething = false;

  // --- name -------------------------------------------------------
  const rawName = (row.name || "").trim();
  if (!rawName) {
    return reject(originalLeadId, "missing name");
  }
  const name = titleCase(rawName);
  if (name !== rawName) fixedSomething = true;

  // --- phone --------------------------------------------------------
  const phone = normalizePhone(row.phone);
  if (!phone) {
    return reject(originalLeadId, `invalid phone number "${row.phone}"`);
  }
  if (phone !== row.phone) {
    issues.push(`phone "${row.phone}" normalized to ${phone}`);
    fixedSomething = true;
  }

  // --- pincode --------------------------------------------------------
  const pincode = row.pincode.trim();
  if (!isValidPincode(pincode)) {
    return reject(originalLeadId, `invalid pincode "${row.pincode}" (must be 6 digits)`);
  }

  // --- date --------------------------------------------------------
  const dateResult = cleanDate(row.created_on);
  if (!dateResult.iso) {
    return reject(originalLeadId, dateResult.detail);
  }
  if (dateResult.wasFixed) {
    issues.push(dateResult.detail);
    fixedSomething = true;
  }

  // --- status / source casing --------------------------------------
  const statusTitled = titleCase(row.status);
  if (!VALID_STATUSES.includes(statusTitled)) {
    return reject(originalLeadId, `unrecognized status "${row.status}"`);
  }
  if (statusTitled !== row.status) fixedSomething = true;

  // Match the source against the exact spellings the web form uses, ignoring
  // case and extra spaces. A plain Title Case would turn "WhatsApp" into
  // "Whatsapp" and "Dealer Walk-in" into "Dealer Walk-In", which would not
  // match what the live form saves.
  const SOURCE_VALUES = ["Website", "Voice Agent", "WhatsApp", "Dealer Walk-in"];
  const sourceKey = String(row.source).trim().toLowerCase();
  const source =
    SOURCE_VALUES.find((s) => s.toLowerCase() === sourceKey) || titleCase(row.source);
  if (source !== row.source) fixedSomething = true;

  // product name is left untouched on purpose - see README "One issue that
  // was not auto-fixed" (e.g. "home battery 5 kwh" for L1023).
  // Guessing the intended canonical product name risks putting a
  // customer on the wrong product; a human should review these.
  const product = row.product.trim();

  // --- lead_id collision (same ID used for a different phone) --------
  let finalLeadId = originalLeadId;
  if (seenLeadIds.has(originalLeadId)) {
    finalLeadId = `${originalLeadId}-DUP`;
    issues.push(`lead_id "${originalLeadId}" was already used by another lead; reassigned to "${finalLeadId}"`);
    fixedSomething = true;
  }

  // --- dealer assignment --------------------------------------------
  const dealer = assignDealer(pincode, dealers);
  const assignedInhouse = dealer.dealer_id === "INHOUSE";

  // --- repeat enquiry (same phone seen before) ----------------------
  // Kept as a separate lead. We only record who the first lead was.
  let repeatOf = null;
  let enquiryNumber = 1;
  if (seenPhones.has(phone)) {
    const entry = seenPhones.get(phone);
    entry.count += 1;
    repeatOf = entry.firstId;
    enquiryNumber = entry.count;
  } else {
    seenPhones.set(phone, { firstId: finalLeadId, count: 1 });
  }
  seenLeadIds.add(finalLeadId);

  const cleanedDoc = {
    lead_id: finalLeadId,
    name,
    phone,
    pincode,
    product,
    source,
    status: statusTitled,
    created_on: dateResult.iso,
    dealer_id: dealer.dealer_id,
    dealer_name: dealer.dealer_name,
    origin: "legacy_import",
    is_repeat: repeatOf !== null,
    repeat_of: repeatOf,
    enquiry_number: enquiryNumber,
  };

  let action;
  let reason;
  if (repeatOf) {
    action = "repeat_enquiry";
    reason =
      `same phone number as ${repeatOf}; kept as its own lead and flagged as repeat enquiry #${enquiryNumber}` +
      (assignedInhouse ? `; no dealer covers pincode ${pincode}, routed to In-house Sales` : "") +
      (issues.length ? `; also: ${issues.join("; ")}` : "");
  } else if (assignedInhouse) {
    action = "assigned_inhouse";
    reason = `no dealer covers pincode ${pincode}; routed to In-house Sales` + (issues.length ? `; also: ${issues.join("; ")}` : "");
  } else if (fixedSomething) {
    action = "fixed";
    reason = issues.length ? issues.join("; ") : "minor formatting cleanup (name/status/source casing)";
  } else {
    action = "imported";
    reason = "clean row, no changes needed";
  }

  return { cleanedDoc, lead_id: finalLeadId, action, reason };
}

function reject(leadId, reason) {
  return { lead_id: leadId, action: "rejected", reason };
}

// ---------------------------------------------------------------------
// Firestore (optional - only runs if a service account key is present)
// ---------------------------------------------------------------------

function tryInitFirestore() {
  if (process.argv.includes("--dry-run")) {
    console.log("\n[info] --dry-run: cleaning and report only, nothing is written to Firestore.\n");
    return null;
  }

  // Option 2 (no key file needed): run with  --adc  after doing
  //   gcloud auth application-default login
  // Uses your own Google login, so org policies that block key
  // creation don't matter. Rules are bypassed because Admin SDK is trusted.
  if (process.argv.includes("--adc")) {
    const admin = require("firebase-admin");
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || "lrdlr-demo",
    });
    console.log("[info] Using Application Default Credentials (--adc)");
    return admin.firestore();
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.log(
      "\n[info] No service-account-key.json found at the project root.\n" +
        "       Running in DRY-RUN mode: the data will be cleaned and\n" +
        "       reports/reconciliation.csv will be written, but nothing\n" +
        "       will be written to Firestore.\n" +
        "       To actually import: Firebase Console > Project Settings >\n" +
        "       Service Accounts > Generate new private key, save it as\n" +
        "       service-account-key.json in the project root (it's already\n" +
        "       in .gitignore - never commit it).\n"
    );
    return null;
  }

  const admin = require("firebase-admin");
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

/** Turns "2026-09-03" into a Firestore Timestamp at midnight India time.
 * Web-form leads use serverTimestamp(), so imported leads must be
 * Timestamps too - otherwise orderBy("created_on") sorts strings and
 * Timestamps as separate groups and the dashboard order looks wrong. */
function toTimestamp(isoDate) {
  const { Timestamp } = require("firebase-admin/firestore");
  return Timestamp.fromDate(new Date(`${isoDate}T00:00:00+05:30`));
}

async function writeToFirestore(db, dealers, cleanedDocs) {
  const batchDealers = db.batch();
  dealers.forEach((d) => {
    const ref = db.collection("dealers").doc(d.dealer_id);
    batchDealers.set(ref, d);
  });
  await batchDealers.commit();
  console.log(`[firestore] upserted ${dealers.length} dealers`);

  // Only create leads that do not exist yet. A lead that is already in
  // Firestore is left untouched, so a status changed on the dashboard is not
  // reset by a re-run. (Batches cap at 500 writes, so we work in chunks.)
  const CHUNK = 400;
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < cleanedDocs.length; i += CHUNK) {
    const chunk = cleanedDocs.slice(i, i + CHUNK);
    const refs = chunk.map((doc) => db.collection("leads").doc(doc.lead_id));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    chunk.forEach((doc, idx) => {
      if (snaps[idx].exists) {
        skipped += 1;
      } else {
        batch.set(refs[idx], { ...doc, created_on: toTimestamp(doc.created_on) });
        created += 1;
      }
    });
    await batch.commit();
  }
  console.log(`[firestore] created ${created} new leads, left ${skipped} existing leads unchanged`);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const dealers = loadDealers();
  const legacyRows = loadLegacyLeads();

  const seenPhones = new Map();
  const seenLeadIds = new Set();

  const reportRows = [];
  const cleanedDocs = [];

  for (const row of legacyRows) {
    const result = cleanRow(row, dealers, seenPhones, seenLeadIds);
    reportRows.push({ lead_id: result.lead_id, action: result.action, reason: result.reason });
    if (result.cleanedDoc) cleanedDocs.push(result.cleanedDoc);
  }

  // --- write the reconciliation report --------------------------------
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const csvOut = stringify(reportRows, { header: true, columns: ["lead_id", "action", "reason"] });
  fs.writeFileSync(path.join(REPORTS_DIR, "reconciliation.csv"), csvOut);

  const counts = reportRows.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] || 0) + 1;
    return acc;
  }, {});
  console.log("Processed", legacyRows.length, "legacy rows:");
  console.table(counts);
  console.log("Report written to reports/reconciliation.csv");

  // --- import into Firestore, if configured ---------------------------
  const db = tryInitFirestore();
  if (db) {
    await writeToFirestore(db, dealers, cleanedDocs);
  }
}

main().catch((err) => {
  console.error("clean-and-import.js failed:", err);
  process.exit(1);
});