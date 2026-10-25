# LRDLR — Lead Router for Dealers

A lead-capture web app that routes every customer lead to the dealer who covers its pincode, plus a Node.js script that cleans a messy legacy CSV export and imports it into the same Firestore database.

> **Demo project.** Every dealer, customer and phone number in this repo is fictional. Cities and pincode prefixes are real geography, used only so the routing rule has realistic input.

**Built with:** HTML, CSS and JavaScript (no build step) · Firebase Firestore · Firebase Hosting · Node.js (import script)

## What it does

| Part | What it does |
|---|---|
| **Lead form** (`index.html`) | Validates name, mobile, pincode, product and source. Assigns the dealer from the pincode. A mobile number that already exists is saved again and flagged as a repeat enquiry, never blocked. |
| **Dashboard** (`dashboard.html`) | Live counts by status and by dealer, filters, a repeat-enquiry badge, and an inline status editor (New → Contacted → Converted / Lost). |
| **Cleanup + import** (`scripts/clean-and-import.js`) | Reads `data/legacy_leads.csv` (40 rows), fixes what is safe to fix, rejects what isn't, writes `reports/reconciliation.csv` with one line per decision, then imports dealers and leads into Firestore. |

## Project layout

```
public/                  The web app (deployed to Firebase Hosting)
  index.html             New Lead form
  dashboard.html         Dashboard
  firebase-init.js       Firebase web config (not secret)
  app.js                 Form validation and save logic
  dashboard.js           Live lead list and status updates
  dealer-assign.js       Pincode -> dealer rule
  validate.js            Phone, pincode and name checks
  style.css
scripts/
  clean-and-import.js    Cleans and imports the legacy CSV
data/
  dealers.csv            6 fictional dealers
  legacy_leads.csv       40 fictional legacy leads with planted data problems
firestore.rules          Security rules
firebase.json, .firebaserc
```

## How to run it

1. Install Node.js 18+, then `npm install`.
2. Put your web app config in `public/firebase-init.js` (Firebase console → Project settings → Your apps).
3. Check your project ID in `.firebaserc`.
4. Test the cleanup without touching the database: `npm run dry-run`
5. Import for real: download a service account key (Project settings → Service accounts → Generate new private key), save it as `service-account-key.json` in the project root (it is git-ignored), then `npm run clean-and-import`. Delete the key from the Google Cloud console when you are done.
6. Run locally: `npm run serve`
7. Deploy: `npx firebase-tools deploy --only hosting,firestore:rules`

Re-running the import is safe: leads already in Firestore are left untouched, so a status changed on the dashboard is never reset.

## How dealer assignment works

The first 3 digits of the pincode are matched against each dealer's `pincode_prefixes`. No match → **In-house Sales**.

| Pincode | Prefix | Dealer |
|---|---|---|
| 560034 | 560 | Tomato Power Hub |
| 571130 | 571 | Brinjal Energy |
| 575001 | 575 | Carrot Cell Traders |
| 400001 | 400 | no dealer → In-house Sales |

The rule exists twice on purpose — `public/dealer-assign.js` (browser) and inside `scripts/clean-and-import.js` (Node) — because there is no shared build step. Change both together.

## Data problems in legacy_leads.csv

| Problem | Example | Handling |
|---|---|---|
| Messy phone formats | `90000 10 004`, `+91-9000010006` | Fixed → plain 10 digits |
| Invalid phone | `12345` (L1009) | Rejected |
| 4-digit pincode | `5600` (L1012) | Rejected — guessing digits could route to the wrong dealer |
| Missing name | L1026 | Rejected |
| Impossible date | `31/09/2026` (L1018) | Fixed → `2026-09-30`, logged in the report |
| Casing / spaces | status `converted `, source `website` | Fixed → `Converted`, `Website` |
| No dealer for pincode | `400001` (L1015) | Routed to In-house Sales |
| Same phone, new lead | L1036 = L1003, etc. | Kept, flagged `is_repeat` with `repeat_of` |
| Reused lead_id | `L1033` appears twice | Second one imported as `L1033-DUP`, flagged as repeat of L1013 |

**Result:**

| Action | Rows |
|---|---|
| imported as-is | 26 |
| fixed | 5 |
| in-house | 1 |
| repeat enquiry | 5 |
| rejected | 3 |

**37 leads kept, 3 rejected.**

**Not auto-fixed:** L1023 has product `home battery 5 kwh`. It is probably *Home Battery 5kWh*, but the script fixes formatting, it does not guess intent — the row is imported as written for a human to review.

## Security

- `dealers`: read-only from the browser.
- `leads`: create only with exactly the fields the form sends (`hasOnly`), valid phone/pincode/product/source, status `New` and server time; only `status` can be updated; no deletes.
- The dashboard text is HTML-escaped, so a malicious name submitted through the public form is shown as text and never runs.
- No login in this demo — a real deployment would put the dashboard behind Firebase Auth.
