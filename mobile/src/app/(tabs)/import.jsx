// import.jsx - Import CSV screen
//
// Same three steps as the website's Import page:
//   1. Pick a CSV (or load the demo sample file from the live site).
//   2. Check every row and show a preview. NOTHING is saved yet.
//   3. On confirm, save the good rows with batch writes (all-or-nothing per
//      batch). If a batch fails, "Try again" carries on from where it stopped,
//      so no row is ever written twice.
// AI fix: a row rejected for an unknown product or source can "Ask AI" for
// the closest allowed value. A person taps "Use it" (or "Keep rejected"),
// and the row is checked again with the normal rules.

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  BATCH_SIZE,
  checkRow,
  loadDealers,
  loadExistingPhones,
  MAX_BYTES,
  MAX_ROWS,
  parseCsvText,
  REQUIRED_COLUMNS,
} from "../../lib/csv-check";
import { produceEmoji } from "../../lib/shared";
import { colors, radius } from "../../lib/theme";
import { aiPost } from "../../lib/ai";

const SAMPLE_URL = "https://lrdlr-demo.web.app/sample-leads.csv";
const TYPOS_URL = "https://lrdlr-demo.web.app/sample-typos.csv";

const RESULT = {
  ready: { label: "Ready", color: colors.leaf },
  fixed: { label: "Fixed", color: "#b97606" },
  repeat: { label: "Repeat", color: "#2d6a9f" },
  rejected: { label: "Rejected", color: colors.chilli },
};

export default function ImportScreen() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);          // checked rows
  const [busy, setBusy] = useState("");          // "reading" | "importing" | ""
  const [pickError, setPickError] = useState("");
  const [written, setWritten] = useState(0);     // rows saved so far (for Try again)
  const [done, setDone] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [rawRows, setRawRows] = useState([]);    // the CSV rows as read, edited by approved AI fixes
  const [ctx, setCtx] = useState(null);          // { dealers, phones } used to re-check a fixed row
  const [aiAnswers, setAiAnswers] = useState({}); // row index -> { state, suggestion, reason, error }
  const [approved, setApproved] = useState({});   // row index -> ["product set to X", ...] (audit trail)

  const good = rows.filter((r) => r.ok);
  const counts = rows.reduce((c, r) => ({ ...c, [r.result]: (c[r.result] || 0) + 1 }), {});

  function reset() {
    setFileName("");
    setRows([]);
    setPickError("");
    setWritten(0);
    setDone(false);
    setSaveError("");
    setRawRows([]);
    setCtx(null);
    setAiAnswers({});
    setApproved({});
  }

  /** Steps 1 + 2: read the text, check the header, check every row. */
  async function checkText(text, name) {
    const parsed = parseCsvText(text);
    const columns = parsed.meta.fields || [];
    const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
    if (missing.length) throw new Error(`The header row is missing: ${missing.join(", ")}.`);
    if (parsed.data.length === 0) throw new Error("This file has a header row but no leads.");
    if (parsed.data.length > MAX_ROWS) throw new Error(`This file has ${parsed.data.length} rows. Import up to ${MAX_ROWS} at a time.`);

    const [dealers, phones] = await Promise.all([loadDealers(), loadExistingPhones()]);
    setRows(parsed.data.map((row) => checkRow(row, dealers, phones)));
    setRawRows(parsed.data);
    setCtx({ dealers, phones });
    setFileName(name);
  }

  // ---- AI fix ----
  const setAnswer = (i, a) => setAiAnswers((m) => ({ ...m, [i]: a }));

  async function askAi(i) {
    setAnswer(i, { state: "loading" });
    try {
      const data = await aiPost("/suggest", rows[i].fixable);
      setAnswer(i, { state: "done", suggestion: data.suggestion, reason: data.reason });
    } catch (err) {
      setAnswer(i, { state: "error", error: err.message });
    }
  }

  /** A person approved the suggestion: fix the cell, check the row again. */
  function useSuggestion(i) {
    const a = aiAnswers[i];
    const field = rows[i].fixable.field;
    const fixedRaw = { ...rawRows[i], [field]: a.suggestion };
    const trail = [...(approved[i] || []), `${field} set to ${a.suggestion}`];

    const result = checkRow(fixedRaw, ctx.dealers, ctx.phones);
    const note = `${trail.join("; ")} (AI suggestion, approved)`;
    if (result.ok) {
      result.reason = note + (result.result === "repeat" ? `; ${result.reason}` : "");
      if (result.result === "ready") result.result = "fixed";
    } else {
      result.reason = `${note}; still: ${result.reason}`;
    }

    setRawRows((r) => r.map((row, k) => (k === i ? fixedRaw : row)));
    setRows((r) => r.map((row, k) => (k === i ? result : row)));
    setApproved((m) => ({ ...m, [i]: trail }));
    setAiAnswers((m) => {
      const next = { ...m };
      delete next[i];
      return next;
    });
  }

  function keepRejected(i) {
    setRows((r) => r.map((row, k) => (k === i ? { ...row, fixable: undefined } : row)));
    setAnswer(i, { state: "done", suggestion: null, reason: "Kept as rejected by you" });
  }

  async function pickFile() {
    reset();
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "application/vnd.ms-excel", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!/\.csv$/i.test(asset.name)) {
        setPickError("Choose a .csv file. Save Excel sheets as CSV first.");
        return;
      }
      if (asset.size && asset.size > MAX_BYTES) {
        setPickError("This file is bigger than 1 MB. Split it into smaller files.");
        return;
      }
      setBusy("reading");
      const text = await new File(asset.uri).text();
      await checkText(text, asset.name);
    } catch (err) {
      setPickError(`Could not read this file: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function useSample(url) {
    reset();
    setBusy("reading");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`the sample file returned ${res.status}`);
      await checkText(await res.text(), url.split("/").pop());
    } catch (err) {
      setPickError(`Could not load the sample file: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  /** Step 3: save the good rows in batches. */
  async function importRows() {
    setBusy("importing");
    setSaveError("");
    let soFar = written;
    try {
      for (let i = soFar; i < good.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = good.slice(i, i + BATCH_SIZE);
        chunk.forEach((r) => batch.set(r.ref, { ...r.lead, created_on: serverTimestamp() }));
        await batch.commit();
        soFar += chunk.length;
        setWritten(soFar);
      }
      setDone(true);
    } catch (err) {
      setSaveError((soFar ? `Imported ${soFar}, then stopped: ` : "Nothing was imported: ") + err.message);
    } finally {
      setBusy("");
    }
  }

  const header = (
    <View style={{ gap: 12 }}>
      <Text style={styles.intro}>
        Add many leads at once. Nothing is saved until you check the preview and confirm. Every imported lead starts as New.
      </Text>

      <View style={styles.card}>
        <Pressable
          onPress={pickFile}
          disabled={!!busy}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        >
          <Text style={styles.primaryText}>📤 Choose CSV file</Text>
        </Pressable>
        <Pressable onPress={() => useSample(SAMPLE_URL)} disabled={!!busy} style={styles.secondary}>
          <Text style={styles.secondaryText}>Try the sample file (13 rows)</Text>
        </Pressable>
        <Pressable onPress={() => useSample(TYPOS_URL)} disabled={!!busy} style={styles.secondary}>
          <Text style={styles.secondaryText}>✨ Try the typos file (AI fix)</Text>
        </Pressable>
        <Text style={styles.hint}>
          Needs a header row with name, phone, pincode, product and source. Up to {MAX_ROWS} rows.
        </Text>
        {pickError ? <Text style={styles.error}>{pickError}</Text> : null}
        {busy === "reading" ? (
          <View style={styles.inline}>
            <ActivityIndicator color={colors.slate} />
            <Text style={styles.hint}>Checking rows…</Text>
          </View>
        ) : null}
      </View>

      {rows.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>Preview · {fileName}</Text>
          <View style={styles.summary}>
            {Object.keys(RESULT).map((k) => (
              <View key={k} style={[styles.pill, { borderColor: RESULT[k].color }]}>
                <Text style={[styles.pillText, { color: RESULT[k].color }]}>
                  {RESULT[k].label} {counts[k] || 0}
                </Text>
              </View>
            ))}
          </View>

          {done ? (
            <>
              <Text style={styles.success}>
                Imported {written} lead{written === 1 ? "" : "s"}
                {rows.length - good.length ? `, skipped ${rows.length - good.length} rejected` : ""}.
              </Text>
              <Pressable onPress={() => router.navigate("/dashboard")} style={styles.secondary}>
                <Text style={styles.secondaryText}>Open the dashboard</Text>
              </Pressable>
              <Pressable onPress={reset} style={styles.secondary}>
                <Text style={styles.secondaryText}>Import another file</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={importRows}
                disabled={!!busy || good.length === 0}
                style={({ pressed }) => [
                  styles.primary,
                  (pressed || busy === "importing") && styles.primaryPressed,
                  good.length === 0 && styles.disabled,
                ]}
              >
                {busy === "importing" ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.primaryText}>
                    {saveError ? "Try again" : `Import ${good.length} lead${good.length === 1 ? "" : "s"}`}
                  </Text>
                )}
              </Pressable>
              <Pressable onPress={reset} disabled={!!busy} style={styles.secondary}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
            </>
          )}
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.page}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => (
        <PreviewRow
          row={item}
          n={index + 1}
          ai={aiAnswers[index]}
          canAsk={!done && busy !== "importing"}
          onAsk={() => askAi(index)}
          onUse={() => useSuggestion(index)}
          onKeep={() => keepRejected(index)}
        />
      )}
    />
  );
}

function PreviewRow({ row, n, ai, canAsk, onAsk, onUse, onKeep }) {
  const r = RESULT[row.result];
  const emoji = produceEmoji(row.name);
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowName} numberOfLines={1}>
          {n}. {emoji ? `${emoji} ` : ""}{row.name}
        </Text>
        <Text style={[styles.result, { color: r.color, borderColor: r.color }]}>{r.label}</Text>
      </View>
      {row.lead ? (
        <Text style={styles.rowDealer}>
          {produceEmoji(row.lead.dealer_name)} {row.lead.dealer_name} · {row.lead.pincode}
        </Text>
      ) : null}
      {row.result !== "ready" ? <Text style={styles.reason}>{row.reason}</Text> : null}
      {row.fixable && canAsk ? <AiFix ai={ai} onAsk={onAsk} onUse={onUse} onKeep={onKeep} /> : null}
      {!row.fixable && ai?.state === "done" && !ai.suggestion ? (
        <Text style={styles.aiNote}>✨ {ai.reason}</Text>
      ) : null}
    </View>
  );
}

/** The "Ask AI" part of a rejected row. */
function AiFix({ ai, onAsk, onUse, onKeep }) {
  if (!ai || ai.state === "error") {
    return (
      <View style={styles.aiBox}>
        {ai?.state === "error" ? <Text style={styles.aiErr}>{ai.error}</Text> : null}
        <Pressable onPress={onAsk} style={styles.aiAsk}>
          <Text style={styles.aiAskText}>{ai ? "✨ Try again" : "✨ Ask AI"}</Text>
        </Pressable>
      </View>
    );
  }
  if (ai.state === "loading") {
    return (
      <View style={[styles.aiBox, styles.inline]}>
        <ActivityIndicator color={colors.slate} />
        <Text style={styles.aiNote}>Asking the AI… (first try after a break can take a minute)</Text>
      </View>
    );
  }
  if (!ai.suggestion) {
    return (
      <View style={styles.aiBox}>
        <Text style={styles.aiNote}>✨ {ai.reason || "No safe match"}, so it stays rejected.</Text>
      </View>
    );
  }
  return (
    <View style={styles.aiBox}>
      <Text style={styles.aiNote}>
        ✨ Probably <Text style={styles.aiStrong}>{ai.suggestion}</Text>
        {ai.reason ? ` — ${ai.reason}` : ""}
      </Text>
      <View style={styles.inline}>
        <Pressable onPress={onUse} style={styles.aiUse}>
          <Text style={styles.aiUseText}>Use it</Text>
        </Pressable>
        <Pressable onPress={onKeep} style={styles.aiAsk}>
          <Text style={styles.aiAskText}>Keep rejected</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 10 },
  intro: { color: colors.muted, fontSize: 14 },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
    marginBottom: 2,
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.ink },
  primary: {
    backgroundColor: colors.turmeric,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryPressed: { backgroundColor: colors.turmericDark },
  primaryText: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.slate,
    paddingVertical: 11,
    alignItems: "center",
  },
  secondaryText: { color: colors.slate, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.muted, fontSize: 13 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: colors.chilli, fontSize: 14 },
  success: { color: colors.leaf, fontSize: 15, fontWeight: "700" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 13, fontWeight: "700" },
  row: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 3,
  },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName: { flexShrink: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  result: {
    fontSize: 12,
    fontWeight: "700",
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  rowDealer: { fontSize: 13, color: colors.ink },
  reason: { fontSize: 13, color: colors.muted },
  aiBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.turmericTint,
    gap: 8,
  },
  aiNote: { fontSize: 13, color: colors.ink },
  aiStrong: { fontWeight: "800" },
  aiErr: { fontSize: 13, color: colors.chilli },
  aiAsk: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.slate,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  aiAskText: { fontSize: 13, fontWeight: "700", color: colors.slate },
  aiUse: {
    backgroundColor: colors.slate,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  aiUseText: { fontSize: 13, fontWeight: "800", color: colors.chalk },
});
