// index.jsx - New lead screen
//
// Same flow as the website's form (public/app.js):
//   1. Validate what the person typed (shared validate.js).
//   2. Show which dealer gets the lead while the pincode is typed
//      (shared dealer-assign.js, the SAME rule the save uses).
//   3. On Save: check the phone for earlier leads (repeat enquiry, never
//      blocked), route by pincode, write to Firestore.
// Smart paste (optional): the AI reads a pasted message and SUGGESTS values
// for the boxes. It never saves; the person checks them and presses Save.
// firestore.rules check the write again, so a bad lead can't get in even
// if this screen had a bug.

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, DEALERS_COLLECTION, LEADS_COLLECTION } from "../../lib/firebase";
import {
  assignDealer,
  isValidName,
  isValidPincode,
  matchAllowed,
  normalizePhone,
  produceEmoji,
  PRODUCT_VALUES,
  SOURCE_VALUES,
} from "../../lib/shared";
import { colors, radius } from "../../lib/theme";
import { aiPost, WAKING_UP } from "../../lib/ai";

// Marks leads typed in the phone app, so reports can tell them apart from
// the website form ('web') and CSV imports ('csv_upload'). firestore.rules
// list every allowed origin.
const ORIGIN = "mobile";

// A real pincode per dealer, so testers don't have to remember one.
const TRY_PINCODES = ["560034", "571130", "575001", "400001"];

const EMPTY = { name: "", phone: "", pincode: "", product: "", source: "" };
const FIELDS = Object.keys(EMPTY);
const FIELD_LABELS = { name: "name", phone: "mobile number", pincode: "pincode", product: "product", source: "source" };

/** Keeps only AI values that pass the same checks the save uses. */
function cleanAiFields(fields = {}) {
  const out = {};
  if (typeof fields.name === "string" && isValidName(fields.name)) out.name = fields.name.trim().slice(0, 100);
  const phone = normalizePhone(fields.phone);
  if (phone) out.phone = phone;
  if (isValidPincode(fields.pincode ?? "")) out.pincode = String(fields.pincode).trim();
  const product = matchAllowed(fields.product, PRODUCT_VALUES);
  if (product) out.product = product;
  const source = matchAllowed(fields.source, SOURCE_VALUES);
  if (source) out.source = source;
  return out;
}

/** Fails loudly instead of leaving the button stuck on "Saving…" forever. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} took too long. Check your internet and try again.`)), ms)
    ),
  ]);
}

async function loadDealers() {
  const snap = await getDocs(collection(db, DEALERS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

async function findLeadsByPhone(phone) {
  const q = query(collection(db, LEADS_COLLECTION), where("phone", "==", phone));
  return (await getDocs(q)).docs;
}

/** Same repeat-enquiry fields the website writes. */
function buildRepeatInfo(existingDocs) {
  if (existingDocs.length === 0) {
    return { is_repeat: false, repeat_of: null, enquiry_number: 1 };
  }
  const original = existingDocs.find((d) => !d.data().is_repeat) || existingDocs[0];
  return {
    is_repeat: true,
    repeat_of: original.data().lead_id || original.id,
    enquiry_number: existingDocs.length + 1,
  };
}

function validate(form) {
  const errors = {};
  const phone = normalizePhone(form.phone);
  if (!isValidName(form.name)) errors.name = "Name is required.";
  if (!phone) errors.phone = "Enter a valid 10-digit mobile number.";
  if (!isValidPincode(form.pincode)) errors.pincode = "Pincode must be exactly 6 digits.";
  if (!form.product) errors.product = "Pick a product.";
  if (!form.source) errors.source = "Pick a source.";
  return { errors, phone };
}

export default function NewLeadScreen() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [dealers, setDealers] = useState([]);
  const [dealerError, setDealerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { kind: "ok" | "error", text }
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState(null); // { kind: "ok" | "warn" | "error" | "info", text }
  const [aiFilled, setAiFilled] = useState([]);   // fields the AI filled and the person hasn't touched

  // Dealers are loaded once, only for the live preview.
  useEffect(() => {
    loadDealers()
      .then(setDealers)
      .catch((err) => setDealerError(`Could not load dealers: ${err.message}`));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setResult(null);
    // Editing a box makes the value the person's own: drop its ✨ mark.
    setAiFilled((a) => a.filter((f) => f !== field));
  }

  async function fillWithAi() {
    const text = aiText.trim();
    if (!text) {
      setAiStatus({ kind: "error", text: "Paste a customer message first." });
      return;
    }
    setAiBusy(true);
    setAiStatus(null);
    setResult(null);
    try {
      const data = await aiPost("/extract", { text }, {
        onSlow: () => setAiStatus({ kind: "info", text: WAKING_UP }),
      });
      const found = cleanAiFields(data.fields);
      const filled = Object.keys(found);

      // Values left by an EARLIER fill that the person never touched are
      // cleared, so two messages can't mix (one customer's name with
      // another's pincode). Anything the person typed stays.
      setForm((f) => {
        const next = { ...f };
        aiFilled.forEach((k) => (next[k] = ""));
        return { ...next, ...found };
      });
      setAiFilled(filled);
      setErrors({});

      const missing = FIELDS.filter((k) => !filled.includes(k)).map((k) => FIELD_LABELS[k]);
      if (filled.length === 0) {
        setAiStatus({ kind: "error", text: "Couldn't find any details in that message. Fill the form by hand." });
      } else if (missing.length) {
        setAiStatus({ kind: "warn", text: `Filled ${filled.length} of 5. Add the ${missing.join(", ")} yourself, check everything, then Save.` });
      } else {
        setAiStatus({ kind: "ok", text: "All 5 filled. Check them, then Save." });
      }
    } catch (err) {
      setAiStatus({ kind: "error", text: err.message });
    } finally {
      setAiBusy(false);
    }
  }

  // Live routing preview: same assignDealer() the save uses.
  const pin = form.pincode.trim();
  let preview = "Type a pincode to see which dealer gets this lead.";
  let previewSet = false;
  if (pin.length >= 3 && /^\d+$/.test(pin) && dealers.length > 0) {
    const d = assignDealer(pin, dealers);
    previewSet = true;
    preview =
      d.dealer_id === "INHOUSE"
        ? `🏠 No dealer covers ${pin.slice(0, 3)}. Goes to In-house Sales.`
        : `${produceEmoji(d.dealer_name)} Goes to ${d.dealer_name}`;
  }

  async function save() {
    const { errors: found, phone } = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setResult(null);
    try {
      const existing = await withTimeout(findLeadsByPhone(phone), 15000, "Repeat check");
      const repeatInfo = buildRepeatInfo(existing);
      const allDealers = await withTimeout(loadDealers(), 15000, "Loading dealers");
      const dealer = assignDealer(form.pincode.trim(), allDealers);

      await withTimeout(
        addDoc(collection(db, LEADS_COLLECTION), {
          name: form.name.trim(),
          phone,
          pincode: form.pincode.trim(),
          product: form.product,
          source: form.source,
          status: "New",
          dealer_id: dealer.dealer_id,
          dealer_name: dealer.dealer_name,
          origin: ORIGIN,
          ...repeatInfo,
          created_on: serverTimestamp(),
        }),
        15000,
        "Saving"
      );

      setResult({
        kind: "ok",
        text:
          `Saved and routed to ${dealer.dealer_name}.` +
          (repeatInfo.is_repeat
            ? ` This number already has ${existing.length} earlier lead(s), so it's a repeat enquiry.`
            : ""),
      });
      setForm(EMPTY);
      setAiFilled([]);
      setAiText("");
      setAiStatus(null);
    } catch (err) {
      setResult({ kind: "error", text: `Couldn't save this lead: ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Every lead goes to the dealer who covers its pincode.
        </Text>

        <View style={[styles.card, styles.aiCard]}>
          <Text style={styles.aiTitle}>✨ Smart paste</Text>
          <Text style={styles.aiHint}>
            Paste a customer message (SMS, email, notes). The AI fills the form; you check it and press Save.
          </Text>
          <TextInput
            style={[styles.input, styles.aiInput]}
            value={aiText}
            onChangeText={setAiText}
            placeholder={"Hi, I'm Kiwi K, need a 5 kWh home battery. Pincode 560034, call 90000 99003"}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
          <Pressable
            onPress={fillWithAi}
            disabled={aiBusy}
            style={({ pressed }) => [styles.aiButton, (pressed || aiBusy) && styles.aiButtonPressed]}
          >
            {aiBusy ? (
              <ActivityIndicator color={colors.chalk} />
            ) : (
              <Text style={styles.aiButtonText}>✨ Fill with AI</Text>
            )}
          </Pressable>
          {aiStatus ? <Text style={[styles.aiStatus, styles[`ai_${aiStatus.kind}`]]}>{aiStatus.text}</Text> : null}
        </View>

        <View style={styles.card}>
          <Field label="Customer name" error={errors.name} ai={aiFilled.includes("name")}>
            <TextInput
              style={[styles.input, aiFilled.includes("name") && styles.inputAi, errors.name && styles.inputError]}
              value={form.name}
              onChangeText={(v) => update("name", v)}
              placeholder="Apple A"
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
            />
          </Field>

          <Field label="Mobile number" error={errors.phone} ai={aiFilled.includes("phone")}>
            <TextInput
              style={[styles.input, aiFilled.includes("phone") && styles.inputAi, errors.phone && styles.inputError]}
              value={form.phone}
              onChangeText={(v) => update("phone", v)}
              placeholder="90000 10001"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              maxLength={16}
            />
          </Field>

          <Field label="Pincode" error={errors.pincode} ai={aiFilled.includes("pincode")}>
            <TextInput
              style={[styles.input, aiFilled.includes("pincode") && styles.inputAi, errors.pincode && styles.inputError]}
              value={form.pincode}
              onChangeText={(v) => update("pincode", v)}
              placeholder="560034"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
            />
            <View style={styles.chipRow}>
              {TRY_PINCODES.map((p) => (
                <Pressable key={p} onPress={() => update("pincode", p)} style={styles.tryChip}>
                  <Text style={styles.tryChipText}>Try {p}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          <View style={[styles.preview, previewSet && styles.previewSet]}>
            <Text style={[styles.previewText, previewSet && styles.previewTextSet]}>{preview}</Text>
          </View>
          {dealerError ? <Text style={styles.error}>{dealerError}</Text> : null}

          <Field label="Product" error={errors.product} ai={aiFilled.includes("product")}>
            <Choices
              options={PRODUCT_VALUES}
              value={form.product}
              onChange={(v) => update("product", v)}
            />
          </Field>

          <Field label="Source" error={errors.source} ai={aiFilled.includes("source")}>
            <Choices
              options={SOURCE_VALUES}
              value={form.source}
              onChange={(v) => update("source", v)}
            />
          </Field>

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.button, (pressed || saving) && styles.buttonPressed]}
          >
            {saving ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={styles.buttonText}>Save lead</Text>
            )}
          </Pressable>

          {result ? (
            <Text style={result.kind === "ok" ? styles.success : styles.error}>{result.text}</Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, error, ai, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {ai ? <Text style={styles.aiTag}>  ✨ AI filled, check it</Text> : null}
      </Text>
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Tap-to-pick chips instead of a dropdown: faster with one thumb. */
function Choices({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.choice, on && styles.choiceOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40 },
  intro: { color: colors.muted, fontSize: 14, marginBottom: 12 },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  inputError: { borderColor: colors.chilli },
  inputAi: { borderColor: colors.turmeric, backgroundColor: colors.turmericTint },
  aiCard: { marginBottom: 14, borderColor: colors.turmeric, gap: 10 },
  aiTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  aiHint: { fontSize: 13, color: colors.muted },
  aiInput: { minHeight: 90, fontSize: 15 },
  aiButton: {
    backgroundColor: colors.slate,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  aiButtonPressed: { opacity: 0.85 },
  aiButtonText: { color: colors.chalk, fontSize: 15, fontWeight: "800" },
  aiStatus: { fontSize: 13, fontWeight: "600" },
  ai_ok: { color: colors.leaf },
  ai_warn: { color: colors.turmericDark },
  ai_error: { color: colors.chilli },
  ai_info: { color: colors.muted },
  aiTag: { fontSize: 12, fontWeight: "700", color: colors.turmericDark },
  error: { color: colors.chilli, fontSize: 13, marginTop: 6 },
  success: { color: colors.leaf, fontSize: 14, marginTop: 12, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tryChipText: { fontSize: 12, color: colors.muted },
  preview: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    padding: 12,
    marginBottom: 14,
  },
  previewSet: {
    borderStyle: "solid",
    borderColor: colors.turmeric,
    backgroundColor: colors.turmericTint,
  },
  previewText: { color: colors.muted, fontSize: 14 },
  previewTextSet: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  choice: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choiceOn: { backgroundColor: colors.slate, borderColor: colors.slate },
  choiceText: { color: colors.ink, fontSize: 14 },
  choiceTextOn: { color: colors.chalk, fontWeight: "700" },
  button: {
    backgroundColor: colors.turmeric,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPressed: { backgroundColor: colors.turmericDark },
  buttonText: { color: colors.ink, fontSize: 16, fontWeight: "800" },
});
