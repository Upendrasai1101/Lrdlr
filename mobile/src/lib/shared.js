// shared.js
//
// One door to the website's own rule files. Screens import from here, never
// from ../public directly, so if a file ever moves only this line changes.
//
// These three files have no imports of their own, so they run the same in
// the browser and on the phone.

export { assignDealer, INHOUSE_DEALER } from "../../../public/dealer-assign.js";
export {
  normalizePhone,
  isValidPincode,
  isValidName,
  matchAllowed,
  STATUS_VALUES,
  PRODUCT_VALUES,
  SOURCE_VALUES,
} from "../../../public/validate.js";
export { produceEmoji } from "../../../public/produce.js";
