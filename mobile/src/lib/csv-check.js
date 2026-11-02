// csv-check.js
//
// The Import CSV rules, the same ones the website's Import page uses
// (public/import.js -> checkRow). Every row ends up as one of:
//   ready    - saved as it is
//   fixed    - saved after a safe clean-up (phone format, product/source casing)
//   repeat   - saved and flagged: this phone already has a lead
//   rejected - not saved, with the reason
//
// The phone, pincode, product and source checks come from the website's own
// validate.js (through shared.js), so a row can't pass here and fail there.

import Papa from "papaparse";
import { collection, doc, getDocs } from "firebase/firestore";
import { db, DEALERS_COLLECTION, LEADS_COLLECTION } from "./firebase";
import {
  assignDealer,
  isValidPincode,
  matchAllowed,
  normalizePhone,
  PRODUCT_VALUES,
  SOURCE_VALUES,
} from "./shared";

export const MAX_ROWS = 500;
export const MAX_BYTES = 1024 * 1024; // 1 MB is plenty for 500 rows
export const REQUIRED_COLUMNS = ["name", "phone", "pincode", "product", "source"];
export const BATCH_SIZE = 400; // Firestore allows 500 writes per batch

/** Header names are trimmed and lower-cased, so "Name" and " PHONE " work. */
export function parseCsvText(text) {
  return Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
}

export async function loadDealers() {
  const snap = await getDocs(collection(db, DEALERS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

/** Phones already in Firestore, so a CSV row for an existing customer is a repeat. */
export async function loadExistingPhones() {
  const snap = await getDocs(collection(db, LEADS_COLLECTION));
  const byPhone = new Map();
  snap.docs.forEach((d) => {
    const lead = d.data();
    if (!lead.phone) return;
    const entry = byPhone.get(lead.phone) || { firstId: null, count: 0 };
    entry.count += 1;
    if (!lead.is_repeat && !entry.firstId) entry.firstId = lead.lead_id || d.id;
    byPhone.set(lead.phone, entry);
  });
  snap.docs.forEach((d) => {
    const entry = byPhone.get(d.data().phone);
    if (entry && !entry.firstId) entry.firstId = d.data().lead_id || d.id;
  });
  return byPhone;
}

/**
 * Checks one row. `phones` is shared across rows, so the second row with the
 * same number in ONE file is a repeat too. Each good row gets its document id
 * up front (ref) so a later repeat in the same file can point at it.
 */
export function checkRow(row, dealers, phones) {
  const notes = [];

  const name = String(row.name ?? "").trim();
  if (!name) return { ok: false, result: "rejected", reason: "Name is missing", name: "(no name)" };
  if (name.length > 100) return { ok: false, result: "rejected", reason: "Name is longer than 100 characters", name };

  const phone = normalizePhone(row.phone);
  if (!phone) return { ok: false, result: "rejected", reason: `"${row.phone ?? ""}" is not a 10-digit mobile number`, name };
  if (phone !== String(row.phone).trim()) notes.push(`phone cleaned to ${phone}`);

  const pincode = String(row.pincode ?? "").trim();
  if (!isValidPincode(pincode)) return { ok: false, result: "rejected", reason: `Pincode "${pincode}" must be 6 digits`, name };

  const product = matchAllowed(row.product, PRODUCT_VALUES);
  // Unknown product/source rows are "fixable": the preview can ask the AI.
  if (!product) return { ok: false, result: "rejected", reason: `Unknown product "${row.product ?? ""}"`, name, fixable: { field: "product", value: String(row.product ?? "") } };
  if (product !== String(row.product).trim()) notes.push(`product set to ${product}`);

  const source = matchAllowed(row.source, SOURCE_VALUES);
  if (!source) return { ok: false, result: "rejected", reason: `Unknown source "${row.source ?? ""}"`, name, fixable: { field: "source", value: String(row.source ?? "") } };
  if (source !== String(row.source).trim()) notes.push(`source set to ${source}`);

  const dealer = assignDealer(pincode, dealers);
  const ref = doc(collection(db, LEADS_COLLECTION)); // an id only, nothing written yet

  let repeatInfo = { is_repeat: false, repeat_of: null, enquiry_number: 1 };
  const seen = phones.get(phone);
  if (seen) {
    seen.count += 1;
    repeatInfo = { is_repeat: true, repeat_of: seen.firstId, enquiry_number: seen.count };
  } else {
    phones.set(phone, { firstId: ref.id, count: 1 });
  }

  const lead = {
    name,
    phone,
    pincode,
    product,
    source,
    status: "New", // always New: a public upload must not be able to fake sales
    dealer_id: dealer.dealer_id,
    dealer_name: dealer.dealer_name,
    origin: "csv_upload",
    ...repeatInfo,
  };

  const extra = notes.length ? `; ${notes.join("; ")}` : "";
  if (repeatInfo.is_repeat) {
    return { ok: true, result: "repeat", reason: `Same phone as an earlier lead (enquiry #${repeatInfo.enquiry_number})${extra}`, name, lead, ref };
  }
  if (notes.length) return { ok: true, result: "fixed", reason: notes.join("; "), name, lead, ref };
  return { ok: true, result: "ready", reason: "Ready", name, lead, ref };
}
