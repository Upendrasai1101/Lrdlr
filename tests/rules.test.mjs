// tests/rules.test.mjs
//
// Checks the small rules every lead goes through, using the SAME files the
// website loads (public/validate.js, public/dealer-assign.js).
// Run with:  npm test      (uses Node's built-in test runner, no installs)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePhone,
  isValidPincode,
  isValidName,
  matchAllowed,
  PRODUCT_VALUES,
  SOURCE_VALUES,
} from "../public/validate.js";
import { assignDealer, INHOUSE_DEALER } from "../public/dealer-assign.js";

const DEALERS = [
  { dealer_id: "D01", dealer_name: "Tomato Power Hub", pincode_prefixes: ["560"] },
  { dealer_id: "D02", dealer_name: "Brinjal Energy", pincode_prefixes: ["570", "571"] },
  { dealer_id: "D03", dealer_name: "Carrot Cell Traders", pincode_prefixes: ["575"] },
];

test("phone: messy formats become 10 digits", () => {
  assert.equal(normalizePhone("9000010001"), "9000010001");
  assert.equal(normalizePhone("90000 10 004"), "9000010004");
  assert.equal(normalizePhone("+91-9000010006"), "9000010006");
  assert.equal(normalizePhone("+91 9000010010"), "9000010010");
});

test("phone: bad numbers are refused", () => {
  assert.equal(normalizePhone("12345"), null);        // too short
  assert.equal(normalizePhone("5000010001"), null);   // Indian mobiles start 6-9
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(undefined), null);
});

test("pincode: exactly 6 digits", () => {
  assert.equal(isValidPincode("560034"), true);
  assert.equal(isValidPincode(" 560034 "), true);
  assert.equal(isValidPincode("5600"), false);
  assert.equal(isValidPincode("56003a"), false);
});

test("name: blank is refused", () => {
  assert.equal(isValidName("Apple A"), true);
  assert.equal(isValidName("   "), false);
});

test("dealer: first 3 digits pick the dealer", () => {
  assert.equal(assignDealer("560034", DEALERS).dealer_name, "Tomato Power Hub");
  assert.equal(assignDealer("571130", DEALERS).dealer_name, "Brinjal Energy"); // second prefix
  assert.equal(assignDealer("575001", DEALERS).dealer_name, "Carrot Cell Traders");
});

test("dealer: no match goes to In-house Sales", () => {
  assert.deepEqual(assignDealer("400001", DEALERS), INHOUSE_DEALER);
});

test("product/source: case and spaces ignored, unknown refused", () => {
  assert.equal(matchAllowed("home battery 5 kwh", PRODUCT_VALUES), "Home Battery 5kWh");
  assert.equal(matchAllowed("whatsapp", SOURCE_VALUES), "WhatsApp");
  assert.equal(matchAllowed("dealer walk-in", SOURCE_VALUES), "Dealer Walk-in");
  assert.equal(matchAllowed("Solar Panel 2kW", PRODUCT_VALUES), null);
  assert.equal(matchAllowed("", PRODUCT_VALUES), null);
});
