// import.js
//
// The "Import CSV" page. Flow, in plain words:
//   1. Person picks a .csv file. Papa Parse turns it into rows (objects).
//   2. Every row is checked with the SAME rules as the New lead form
//      (validate.js) and routed with the SAME dealer rule (dealer-assign.js).
//      Nothing is written yet - the person sees a preview with a result per row.
//   3. On "Import", only the good rows are written to Firestore in batches.
//      Every imported lead starts as status "New", origin "csv_upload".
//
// Why status is always "New": the page is public, so trusting a "status"
// column would let anyone upload fake "Converted" sales. New leads start
// as New; the team moves them forward on the dashboard.

import { db, LEADS_COLLECTION, DEALERS_COLLECTION } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  normalizePhone,
  isValidPincode,
  PRODUCT_VALUES,
  SOURCE_VALUES,
  matchAllowed,
} from "./validate.js";
import { assignDealer } from "./dealer-assign.js";
import { produceEmoji } from "./produce.js";

const MAX_ROWS = 500;
const MAX_BYTES = 1024 * 1024; // 1 MB is plenty for 500 rows
const REQUIRED_COLUMNS = ["name", "phone", "pincode", "product", "source"];
const BATCH_SIZE = 400; // Firestore allows 500 writes per batch

const fileInput = document.getElementById("csv-file");
const pickError = document.getElementById("pick-error");
const previewPanel = document.getElementById("preview-panel");
const fileNameEl = document.getElementById("file-name");
const summaryEl = document.getElementById("summary");
const tbody = document.getElementById("preview-tbody");
const importBtn = document.getElementById("import-btn");
const cancelBtn = document.getElementById("cancel-btn");
const statusEl = document.getElementById("form-status");

let checkedRows = []; // result of checkRow() for every row of the current file
let writtenSoFar = 0; // rows already committed, so "Try again" never writes them twice

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------
// Step 1: read the file
// ---------------------------------------------------------------------

/** Papa Parse with a header row. Header names are trimmed and lower-cased
 * so "Name", " PHONE " and "phone" all work. */
function parseCsv(file) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => resolve(result),
      error: (err) => reject(err),
    });
  });
}

// ---------------------------------------------------------------------
// Step 2: check every row (no writes)
// ---------------------------------------------------------------------

/** Who already exists in Firestore, keyed by phone, so a CSV row for an
 * existing customer is flagged as a repeat enquiry - same as the form. */
async function loadExistingPhones() {
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
  // a phone whose only leads are repeats still needs an id to point at
  snap.docs.forEach((d) => {
    const entry = byPhone.get(d.data().phone);
    if (entry && !entry.firstId) entry.firstId = d.data().lead_id || d.id;
  });
  return byPhone;
}

async function loadDealers() {
  const snap = await getDocs(collection(db, DEALERS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

/**
 * Checks one CSV row. Returns { ok, result, reason, lead } where result is
 * "ready" | "fixed" | "repeat" | "rejected". `phones` is shared across
 * rows so the second row with the same number in ONE file is a repeat too.
 * Each new lead gets its document id up front (newRef) so a later repeat
 * in the same file can point at it.
 */
function checkRow(row, dealers, phones) {
  const notes = [];

  const rawName = String(row.name ?? "").trim();
  if (!rawName) return { ok: false, result: "rejected", reason: "Name is missing" };
  if (rawName.length > 100) return { ok: false, result: "rejected", reason: "Name is longer than 100 characters" };

  const phone = normalizePhone(row.phone);
  if (!phone) return { ok: false, result: "rejected", reason: `"${row.phone ?? ""}" is not a 10-digit mobile number` };
  if (phone !== String(row.phone).trim()) notes.push(`phone cleaned to ${phone}`);

  const pincode = String(row.pincode ?? "").trim();
  if (!isValidPincode(pincode)) return { ok: false, result: "rejected", reason: `Pincode "${pincode}" must be 6 digits` };

  // Unlike the one-off import script, the browser can only save products and
  // sources the security rules allow, so an unknown value is a rejection.
  const product = matchAllowed(row.product, PRODUCT_VALUES);
  if (!product) return { ok: false, result: "rejected", reason: `Unknown product "${row.product ?? ""}"` };
  if (product !== String(row.product).trim()) notes.push(`product set to ${product}`);

  const source = matchAllowed(row.source, SOURCE_VALUES);
  if (!source) return { ok: false, result: "rejected", reason: `Unknown source "${row.source ?? ""}"` };
  if (source !== String(row.source).trim()) notes.push(`source set to ${source}`);

  const dealer = assignDealer(pincode, dealers);
  const newRef = doc(collection(db, LEADS_COLLECTION)); // id only, nothing written

  let repeatInfo = { is_repeat: false, repeat_of: null, enquiry_number: 1 };
  const seen = phones.get(phone);
  if (seen) {
    seen.count += 1;
    repeatInfo = { is_repeat: true, repeat_of: seen.firstId, enquiry_number: seen.count };
  } else {
    phones.set(phone, { firstId: newRef.id, count: 1 });
  }

  const lead = {
    name: rawName,
    phone,
    pincode,
    product,
    source,
    status: "New",
    dealer_id: dealer.dealer_id,
    dealer_name: dealer.dealer_name,
    origin: "csv_upload",
    ...repeatInfo,
  };

  if (repeatInfo.is_repeat) {
    return { ok: true, result: "repeat", reason: `Same phone as an earlier lead (enquiry #${repeatInfo.enquiry_number})` + (notes.length ? `; ${notes.join("; ")}` : ""), lead, ref: newRef };
  }
  if (notes.length) return { ok: true, result: "fixed", reason: notes.join("; "), lead, ref: newRef };
  return { ok: true, result: "ready", reason: "Ready", lead, ref: newRef };
}

const RESULT_LABEL = { ready: "Ready", fixed: "Fixed", repeat: "Repeat", rejected: "Rejected" };

function renderPreview(rows, raw) {
  const count = { ready: 0, fixed: 0, repeat: 0, rejected: 0 };
  rows.forEach((r) => (count[r.result] += 1));

  summaryEl.innerHTML = ["ready", "fixed", "repeat", "rejected"]
    .map((k) => `<span class="chip chip-${k}">${count[k]} ${RESULT_LABEL[k].toLowerCase()}</span>`)
    .join("");

  tbody.innerHTML = rows
    .map((r, i) => {
      const src = raw[i];
      const name = r.lead ? r.lead.name : src.name;
      const emoji = produceEmoji(name);
      const goesTo = r.lead
        ? `${produceEmoji(r.lead.dealer_name)} ${escapeHtml(r.lead.dealer_name)}`
        : "—";
      return `
        <tr class="row-${r.result}">
          <td class="muted">${i + 2}</td>
          <td class="cell-name">${emoji ? `<span aria-hidden="true">${emoji}</span> ` : ""}${escapeHtml(name)}</td>
          <td>${escapeHtml(r.lead ? r.lead.phone : src.phone)}</td>
          <td>${escapeHtml(r.lead ? r.lead.pincode : src.pincode)}</td>
          <td>${escapeHtml(r.lead ? r.lead.product : src.product)}</td>
          <td>${escapeHtml(r.lead ? r.lead.source : src.source)}</td>
          <td>${goesTo}</td>
          <td><span class="result result-${r.result}">${RESULT_LABEL[r.result]}</span>
              ${r.result === "ready" ? "" : `<span class="result-reason">${escapeHtml(r.reason)}</span>`}</td>
        </tr>`;
    })
    .join("");

  const importable = rows.filter((r) => r.ok).length;
  importBtn.textContent = importable === 1 ? "Import 1 lead" : `Import ${importable} leads`;
  importBtn.disabled = importable === 0;
}

function resetPage() {
  checkedRows = [];
  writtenSoFar = 0;
  fileInput.value = "";
  previewPanel.hidden = true;
  tbody.innerHTML = "";
  summaryEl.innerHTML = "";
  statusEl.textContent = "";
  statusEl.className = "";
  importBtn.disabled = false;
}

fileInput.addEventListener("change", async () => {
  pickError.textContent = "";
  statusEl.textContent = "";
  statusEl.className = "";
  const file = fileInput.files[0];
  if (!file) return;

  if (!/\.csv$/i.test(file.name)) {
    pickError.textContent = "Choose a .csv file. Save Excel sheets as CSV first (File > Save As > CSV).";
    return;
  }
  if (file.size > MAX_BYTES) {
    pickError.textContent = "This file is bigger than 1 MB. Split it into smaller files.";
    return;
  }

  try {
    const parsed = await parseCsv(file);
    const columns = parsed.meta.fields || [];
    const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
    if (missing.length) {
      pickError.textContent = `The header row is missing: ${missing.join(", ")}. Download the sample file to see the expected columns.`;
      return;
    }
    if (parsed.data.length === 0) {
      pickError.textContent = "This file has a header row but no leads.";
      return;
    }
    if (parsed.data.length > MAX_ROWS) {
      pickError.textContent = `This file has ${parsed.data.length} rows. Import up to ${MAX_ROWS} at a time.`;
      return;
    }

    const [dealers, phones] = await Promise.all([loadDealers(), loadExistingPhones()]);
    checkedRows = parsed.data.map((row) => checkRow(row, dealers, phones));
    writtenSoFar = 0;
    importBtn.disabled = false;

    fileNameEl.textContent = `· ${file.name}`;
    renderPreview(checkedRows, parsed.data);
    previewPanel.hidden = false;
    previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    pickError.textContent = "Could not read this file: " + err.message;
  }
});

// ---------------------------------------------------------------------
// Step 3: write the good rows
// ---------------------------------------------------------------------

importBtn.addEventListener("click", async () => {
  const toWrite = checkedRows.filter((r) => r.ok);
  if (toWrite.length === 0) return;

  importBtn.disabled = true;
  cancelBtn.disabled = true;
  importBtn.textContent = "Importing…";
  statusEl.textContent = "";
  statusEl.className = "";

  try {
    for (let i = writtenSoFar; i < toWrite.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = toWrite.slice(i, i + BATCH_SIZE);
      chunk.forEach((r) => {
        batch.set(r.ref, { ...r.lead, created_on: serverTimestamp() });
      });
      await batch.commit(); // all-or-nothing per batch
      writtenSoFar += chunk.length;
    }
    const written = writtenSoFar;
    const skipped = checkedRows.length - toWrite.length;
    statusEl.innerHTML =
      `Imported ${written} lead${written === 1 ? "" : "s"}` +
      (skipped ? `, skipped ${skipped} rejected row${skipped === 1 ? "" : "s"}` : "") +
      `. <a href="dashboard.html">Open the dashboard</a>`;
    statusEl.className = "success";
    importBtn.textContent = "Imported";
    fileInput.value = "";
  } catch (err) {
    statusEl.textContent =
      (writtenSoFar ? `Imported ${writtenSoFar}, then stopped: ` : "Nothing was imported: ") + err.message;
    statusEl.className = "error";
    importBtn.disabled = false;
    importBtn.textContent = "Try again";
  } finally {
    cancelBtn.disabled = false;
  }
});

cancelBtn.addEventListener("click", resetPage);