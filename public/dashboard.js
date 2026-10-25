// dashboard.js
//
// Shows every lead, with live counts by dealer and by status, and lets
// a manager change a lead's status inline (New -> Contacted -> Converted
// / Lost). Uses onSnapshot so the dashboard updates in real time if two
// people have it open at once - no manual refresh needed.

import { db, LEADS_COLLECTION } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { STATUS_VALUES } from "./validate.js";
import { produceEmoji } from "./produce.js";
import { AI_BASE_URL } from "./ai-config.js";

const tbody = document.getElementById("leads-tbody");
const statusStats = document.getElementById("status-stats");
const dealerStats = document.getElementById("dealer-stats");
const filterDealer = document.getElementById("filter-dealer");
const filterStatus = document.getElementById("filter-status");
const filterRepeat = document.getElementById("filter-repeat");

let allLeads = []; // the full, unfiltered list we got from Firestore
let phoneCounts = {}; // phone number -> how many leads share it (repeat enquiries)

// Anyone can submit the public form, so a "name" could contain HTML like
// <img src=x onerror=...>. Every value from Firestore goes through this
// before it is put into innerHTML, so it shows as text and never runs.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(ts) {
  if (!ts) return "-";
  // Both web leads (serverTimestamp) and imported leads (the import script
  // converts the CSV date) are Firestore Timestamps, so they sort together.
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

// A phone number that appears on more than one lead is a repeat enquiry.
// Every enquiry is kept. This only marks them so they are easy to spot.
function countByPhone(leads) {
  const counts = {};
  leads.forEach((l) => {
    if (l.phone) counts[l.phone] = (counts[l.phone] || 0) + 1;
  });
  return counts;
}

function renderStats(leads) {
  const byStatus = {};
  STATUS_VALUES.forEach((s) => (byStatus[s] = 0));
  const byDealer = {};

  leads.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const key = l.dealer_name || "Unassigned";
    byDealer[key] = (byDealer[key] || 0) + 1;
  });

  const repeatCustomers = Object.values(phoneCounts).filter((n) => n > 1).length;

  statusStats.innerHTML =
    STATUS_VALUES.map(
      (s) =>
        `<div class="status-tile status-${s.toLowerCase()}"><span class="num">${byStatus[s] || 0}</span><span class="label">${s}</span></div>`
    ).join("") +
    `<div class="status-tile status-repeat"><span class="num">${repeatCustomers}</span><span class="label">Repeat customers</span></div>`;

  // One row per dealer with a bar sized against the busiest dealer.
  const entries = Object.entries(byDealer).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  dealerStats.innerHTML = entries
    .map(
      ([name, count]) => `
      <li class="dealer-bar">
        <span class="dealer-label"><span aria-hidden="true">${produceEmoji(name)}</span> ${escapeHtml(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
        <span class="dealer-count">${count}</span>
      </li>`
    )
    .join("");
}

function populateDealerFilter(leads) {
  const dealers = [...new Set(leads.map((l) => l.dealer_name).filter(Boolean))].sort();
  const current = filterDealer.value;
  filterDealer.innerHTML =
    `<option value="">All dealers</option>` +
    dealers.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  filterDealer.value = current;
}

async function onStatusChange(leadId, newStatus) {
  try {
    await updateDoc(doc(db, LEADS_COLLECTION, leadId), { status: newStatus });
  } catch (err) {
    console.error("Failed to update status", err);
    alert("Could not update status. See console for details.");
  }
}

function renderTable() {
  const dealerFilterVal = filterDealer.value;
  const statusFilterVal = filterStatus.value;
  const repeatFilterVal = filterRepeat.value;

  const filtered = allLeads.filter((l) => {
    if (dealerFilterVal && l.dealer_name !== dealerFilterVal) return false;
    if (statusFilterVal && l.status !== statusFilterVal) return false;
    if (repeatFilterVal === "repeat" && (phoneCounts[l.phone] || 0) < 2) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">No leads match these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((l) => {
      const statusOptions = STATUS_VALUES.map(
        (s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${s}</option>`
      ).join("");
      const sharedCount = phoneCounts[l.phone] || 0;
      const repeatBadge =
        sharedCount > 1
          ? ` <span class="repeat-badge" title="This phone number has ${sharedCount} leads">Repeat ×${sharedCount}</span>`
          : "";
      const emoji = produceEmoji(l.name);
      return `
        <tr>
          <td class="cell-name">${emoji ? `<span aria-hidden="true">${emoji}</span> ` : ""}${escapeHtml(l.name)}${repeatBadge}</td>
          <td>${escapeHtml(l.phone)}</td>
          <td>${escapeHtml(l.pincode)}</td>
          <td>${escapeHtml(l.product)}</td>
          <td>${escapeHtml(l.dealer_name || "-")}</td>
          <td>${escapeHtml(l.source)}</td>
          <td>${formatDate(l.created_on)}</td>
          <td>
            <select class="status-select status-${String(l.status).toLowerCase()}" data-id="${escapeHtml(l.id)}" aria-label="Status for ${escapeHtml(l.name)}">
              ${statusOptions}
            </select>
          </td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      // Recolour straight away; onSnapshot will redraw with the saved value.
      e.target.className = `status-select status-${e.target.value.toLowerCase()}`;
      onStatusChange(e.target.dataset.id, e.target.value);
    });
  });
}

function render() {
  phoneCounts = countByPhone(allLeads);
  renderStats(allLeads);
  populateDealerFilter(allLeads);
  renderTable();
}

// ---------------------------------------------------------------------
// AI briefing: send ONLY counts to the AI server, get a short summary back.
// ---------------------------------------------------------------------

const summaryBtn = document.getElementById("summary-btn");
const summaryText = document.getElementById("summary-text");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Turns the live lead list into plain numbers. No names, no phones. */
function buildStats(leads) {
  const now = Date.now();
  const byStatus = {};
  STATUS_VALUES.forEach((s) => (byStatus[s] = 0));
  const byDealer = {};
  const byOrigin = {};
  let newOlderThan7Days = 0;
  let addedLast7Days = 0;

  leads.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const dealer = l.dealer_name || "Unassigned";
    byDealer[dealer] = (byDealer[dealer] || 0) + 1;
    const origin = l.origin || "unknown";
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;

    const created = l.created_on && l.created_on.toDate ? l.created_on.toDate().getTime() : null;
    if (created && now - created <= 7 * DAY_MS) addedLast7Days += 1;
    if (created && l.status === "New" && now - created > 7 * DAY_MS) newOlderThan7Days += 1;
  });

  // Do the comparisons here, in code, so the AI never has to rank numbers
  // itself (an early version called the 2nd-busiest dealer "the highest").
  const dealersRanked = Object.entries(byDealer)
    .filter(([name]) => name !== "In-house Sales")
    .sort((a, b) => b[1] - a[1])
    .map(([dealer, leadsCount]) => ({ dealer, leads: leadsCount }));

  return {
    total_leads: leads.length,
    by_status: byStatus,
    dealers_ranked_busiest_first: dealersRanked,
    in_house_sales_leads: byDealer["In-house Sales"] || 0,
    by_origin: byOrigin,
    repeat_customers: Object.values(phoneCounts).filter((n) => n > 1).length,
    added_last_7_days: addedLast7Days,
    new_leads_waiting_over_7_days: newOlderThan7Days,
  };
}

summaryBtn.addEventListener("click", async () => {
  if (allLeads.length === 0) {
    summaryText.textContent = "There are no leads to summarize yet.";
    return;
  }
  summaryBtn.disabled = true;
  summaryBtn.textContent = "Writing…";
  summaryText.className = "ai-summary-text muted";
  summaryText.textContent = "Reading the numbers…";
  const slowHint = setTimeout(() => {
    summaryText.textContent = "Waking up the AI server. The first try after a break can take up to a minute…";
  }, 5000);
  const controller = new AbortController();
  const hardStop = setTimeout(() => controller.abort(), 75000);

  try {
    const res = await fetch(`${AI_BASE_URL}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats: buildStats(allLeads) }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `AI server returned ${res.status}`);
    summaryText.className = "ai-summary-text";
    summaryText.textContent = data.summary; // textContent: AI text is never treated as HTML
  } catch (err) {
    summaryText.className = "ai-summary-text error";
    summaryText.textContent =
      err.name === "AbortError" ? "The AI took too long. Try again in a minute."
      : err.message === "Failed to fetch" ? "Can't reach the AI server right now. The numbers below are still live."
      : err.message;
  } finally {
    clearTimeout(slowHint);
    clearTimeout(hardStop);
    summaryBtn.disabled = false;
    summaryBtn.textContent = "Summarize again";
  }
});

filterDealer.addEventListener("change", renderTable);
filterStatus.addEventListener("change", renderTable);
filterRepeat.addEventListener("change", renderTable);

const leadsQuery = query(collection(db, LEADS_COLLECTION), orderBy("created_on", "desc"));
onSnapshot(
  leadsQuery,
  (snap) => {
    allLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  },
  (err) => {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Could not load leads: ${escapeHtml(err.message)}</td></tr>`;
  }
);