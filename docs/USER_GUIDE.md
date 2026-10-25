# LRDLR — User guide

**Live app:** https://lrdlr-demo.web.app · Works on phone and laptop · No login needed (demo)

LRDLR sends every customer enquiry to the dealer who covers the customer's pincode. The first three digits of the pincode decide the dealer; pincodes no dealer covers go to **In-house Sales**.

---

## 1. Add one lead — *New lead*

1. Fill **Customer name**, **Mobile number** (10 digits, `+91` and spaces are fine), **Pincode** (6 digits), **Product** and **Source**.
2. As you type the pincode, the matching dealer stall lights up and the box under it says where the lead will go. Not sure of a pincode? Click a **Try 560034**-style link on any stall.
3. Press **Save lead**. The green message confirms the dealer.

**✨ Got the details in a message?** Paste the customer's WhatsApp or call notes into **Paste a customer message** and press **Fill with AI**.
- Boxes the AI filled turn **yellow**. Check each one — editing a box turns it back to normal.
- Anything the AI wasn't sure of stays **empty** for you to fill.
- The AI never saves. **You** press **Save lead**.

**Same customer again?** That's fine. A number we already have is saved as a new lead and marked **Repeat** — nothing is lost.

## 2. Add many leads — *Import CSV*

1. Your file needs a header row with `name, phone, pincode, product, source` (other columns are ignored, up to 500 rows). Download the **sample file** to see the format.
2. Press **Choose CSV file**. Nothing is saved yet — you see a **preview**:

   | Result | Meaning |
   |---|---|
   | 🟢 Ready | Saved as it is |
   | 🟡 Fixed | Cleaned up (e.g. phone `+91-…` → 10 digits); the reason is shown |
   | 🔵 Repeat | Phone already exists; saved and marked as a repeat |
   | 🔴 Rejected | Can't be saved; the reason is shown |

3. **✨ Ask AI** appears on rows rejected for a misspelt **product** or **source**. If the AI finds a clear match, click **Use it**; otherwise keep it rejected. Bad phone numbers and pincodes are never guessed — fix those in the file.
4. Press **Import N leads**. Every imported lead starts as **New**.

## 3. Follow up — *Dashboard*

- **Leads by status** and **Leads by dealer** update live — no refresh needed.
- Change a lead's status in the table (**New → Contacted → Converted / Lost**). It saves straight away.
- Use the filters to see one dealer, one status, or repeat enquiries only.
- **✨ Summarize** writes a short briefing and one next step. Only counts are sent to the AI — never names or phone numbers.

## Good to know

- The first AI request after a quiet spell can take up to a minute while the AI server wakes up. After that it's quick.
- If the AI is unavailable, everything else still works — fill the form by hand.
- Leads can't be deleted from the app. Ask the administrator.

Something not working? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
