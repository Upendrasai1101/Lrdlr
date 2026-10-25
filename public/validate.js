// validate.js
//
// Small, boring, well-tested validation helpers. Kept separate from
// app.js so the rules are easy to find and easy to explain in an
// interview ("show me where phone numbers get validated" -> this file).

/**
 * Normalizes a phone number typed in any of the messy formats we saw in
 * legacy_leads.csv ("90000 10 004", "+91-9000010006", "+91 9000010010")
 * down to a plain 10-digit string, or returns null if it can't produce
 * a valid 10-digit Indian mobile number.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  // Strip everything except digits.
  let digits = String(raw).replace(/\D/g, "");
  // Drop a leading country code "91" if the number is 12 digits long.
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10) return null;
  // Indian mobile numbers start with 6, 7, 8 or 9.
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

/**
 * A pincode is valid if it's exactly 6 digits. We don't try to verify it
 * is a REAL pincode (that would need a pincode database) - just that it's
 * the right shape.
 */
export function isValidPincode(raw) {
  return /^\d{6}$/.test(String(raw).trim());
}

export function isValidName(raw) {
  return typeof raw === "string" && raw.trim().length > 0;
}

export const STATUS_VALUES = ["New", "Contacted", "Converted", "Lost"];

// The only products and sources firestore.rules accepts. Keep these three
// lists in step with the rules file and the <option>s in index.html.
export const PRODUCT_VALUES = ["Home Battery 3kWh", "Home Battery 5kWh", "Commercial Battery 10kWh"];
export const SOURCE_VALUES = ["Website", "Voice Agent", "WhatsApp", "Dealer Walk-in"];

/**
 * Matches messy text to one of the allowed values, ignoring case and
 * spaces: "home battery 5 kwh" -> "Home Battery 5kWh". Returns null if
 * nothing matches, so the caller can reject the row instead of guessing.
 */
export function matchAllowed(raw, allowed) {
  const key = String(raw ?? "").toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  return allowed.find((v) => v.toLowerCase().replace(/\s+/g, "") === key) || null;
}