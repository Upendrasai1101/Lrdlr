# LRDLR — Troubleshooting

Start with the message the app shows — it names the problem. If you need more detail, open the browser console (**F12 → Console**).

## For users

| You see | What it means | What to do |
|---|---|---|
| "Pincode must be exactly 6 digits." | The pincode is too short or has letters | Type all 6 digits |
| "Enter a valid 10-digit mobile number." | Fewer than 10 digits, or doesn't start with 6–9 | Check the number; `+91` and spaces are fine |
| "Waking up the AI server…" | The free AI server was asleep | Wait up to a minute. Only the first request is slow |
| "Can't reach the AI server…" | AI server down or your network blocks it | Fill the form by hand; try again later |
| "Couldn't find any details in that message." | The pasted text has no name/phone/pincode | Fill the form by hand |
| "Too many requests. Wait a minute…" | More than 20 AI requests in a minute | Wait 60 seconds |
| Page looks old after an update | Browser cached the old files | Press **Ctrl + Shift + R** |
| "Something went wrong saving this lead: Missing or insufficient permissions" | The data broke a security rule | Report it (see admins below) |
| CSV: "The header row is missing: …" | Column names are wrong | Download the sample file and copy its header row |

## For admins

**Check the AI server**
Open https://lrdlr-ai.onrender.com/health → expect `{"model": "...", "ok": true}`.
- No answer for ~1 minute, then OK → it was asleep (free plan). Normal.
- Error page → Render dashboard → **lrdlr-ai → Logs**.

**Common Render problems**

| Log line | Fix |
|---|---|
| `No module named 'your_application'` | Start command is the placeholder. Set `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 60` |
| `Could not open requirements file` | Root Directory must be `ai-server` |
| AI features answer "could not read this message" and logs say `GROQ_API_KEY is not set` / `Groq returned 401` | Set or fix `GROQ_API_KEY` under **Environment**, then redeploy |
| `Groq returned 404` / model error | Model was renamed or retired. Change `GROQ_MODEL` under **Environment** |

**"Can't reach the AI server" only on the live site**
The site's address must be in `ALLOWED_ORIGINS` (defaults include `lrdlr-demo.web.app` and `lrdlr-demo.firebaseapp.com`). Console shows a **CORS** error when it isn't.

**Saving fails with "Missing or insufficient permissions"**
The browser sent a lead the Firestore rules refuse. Check that `PRODUCT_VALUES` / `SOURCE_VALUES` in `public/validate.js` match the lists in `firestore.rules`, then redeploy rules:
`npx firebase-tools deploy --only firestore:rules`

**Rules won't deploy: "Compilation errors in firestore.rules"**
Usually another file's content was pasted into it. The first line must be `rules_version = '2';`.

**Dashboard empty or "Could not load leads"**
Firestore rules not deployed, or wrong project in `public/firebase-init.js` / `.firebaserc`.

**Firebase CLI deploys to the wrong project / account**
`npx firebase-tools login:list` → `login:use <account>` → `projects:list` should show `lrdlr-demo (current)`.

**Run the tests**
- Website rules: `npm test`
- AI server: `cd ai-server` then `python -m unittest -v`

Both run offline; the AI server tests use a fake Groq so they cost nothing.
