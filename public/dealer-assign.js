// dealer-assign.js
//
// Shared logic for picking which dealer a lead should be routed to.
// Used by both the public lead form (app.js) and can be reasoned about
// identically to how scripts/clean-and-import.js assigns dealers on the
// Node.js side - same rule, written twice because one runs in the browser
// and one runs in Node, but they must never disagree.
//
// RULE: take the first 3 digits of the lead's pincode ("the prefix") and
// look for a dealer whose pincode_prefixes list contains that prefix.
// dealers.pincode_prefixes is stored as an ARRAY in Firestore (we split
// the pipe-separated CSV column into an array at import time), e.g.
// Brinjal Energy -> ["570", "571"].
// If no dealer matches, the lead falls back to "In-house Sales".

export const INHOUSE_DEALER = {
  dealer_id: "INHOUSE",
  dealer_name: "In-house Sales",
};

/**
 * @param {string} pincode - 6-digit pincode string, already validated.
 * @param {Array<{dealer_id:string, dealer_name:string, pincode_prefixes:string[]}>} dealers
 * @returns {{dealer_id:string, dealer_name:string}}
 */
export function assignDealer(pincode, dealers) {
  const prefix = String(pincode).slice(0, 3);
  const match = dealers.find((d) => d.pincode_prefixes.includes(prefix));
  if (match) {
    return { dealer_id: match.dealer_id, dealer_name: match.dealer_name };
  }
  return INHOUSE_DEALER;
}
