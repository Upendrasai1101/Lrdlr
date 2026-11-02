// lead/[id].jsx - Lead detail screen
//
// Opens when a lead is tapped in the Leads list. It listens to that ONE
// document, so a status changed on the website shows here at once too.
//
// Only the status can be changed. That is not just this screen's choice:
// firestore.rules allow an update only when the status is the one field
// that changed, and only to New / Contacted / Converted / Lost.

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, LEADS_COLLECTION } from "../../lib/firebase";
import { produceEmoji, STATUS_VALUES } from "../../lib/shared";
import { colors, radius, statusColors } from "../../lib/theme";

function formatDateTime(ts) {
  if (!ts || typeof ts.toDate !== "function") return "Just now";
  return ts.toDate().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ORIGIN_LABELS = {
  web: "Website form",
  mobile: "Mobile app",
  csv_upload: "CSV import",
  legacy_import: "Legacy data import",
};

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams();
  const [lead, setLead] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");     // the status being saved
  const [note, setNote] = useState(null);       // { kind, text }

  useEffect(() => {
    const stop = onSnapshot(
      doc(db, LEADS_COLLECTION, String(id)),
      (snap) =>
        setLead(snap.exists() ? { id: snap.id, ...snap.data({ serverTimestamps: "estimate" }) } : null),
      (err) => setError(`Could not load this lead: ${err.message}`)
    );
    return stop;
  }, [id]);

  async function changeStatus(status) {
    if (!lead || status === lead.status || saving) return;
    setSaving(status);
    setNote(null);
    try {
      await updateDoc(doc(db, LEADS_COLLECTION, lead.id), { status });
      setNote({ kind: "ok", text: `Status changed to ${status}.` });
    } catch (err) {
      setNote({ kind: "error", text: `Couldn't change status: ${err.message}` });
    } finally {
      setSaving("");
    }
  }

  if (error || lead === null) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Lead" }} />
        <Text style={styles.error}>{error || "This lead no longer exists."}</Text>
      </View>
    );
  }

  if (lead === undefined) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Lead" }} />
        <ActivityIndicator color={colors.slate} />
      </View>
    );
  }

  const emoji = produceEmoji(lead.name);
  const statusColor = statusColors[lead.status] || colors.muted;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: lead.name }} />

      <View style={styles.card}>
        <View style={styles.headRow}>
          <Text style={styles.name}>{emoji ? `${emoji} ` : ""}{lead.name}</Text>
          <View style={[styles.badge, { borderColor: statusColor }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>{lead.status}</Text>
          </View>
        </View>

        <View style={styles.dealerBox}>
          <Text style={styles.dealerLabel}>Routed to</Text>
          <Text style={styles.dealerName}>
            {produceEmoji(lead.dealer_name)} {lead.dealer_name}
          </Text>
          <Text style={styles.dealerHint}>Pincode {lead.pincode} · prefix {String(lead.pincode).slice(0, 3)}</Text>
        </View>

        <Row label="Mobile" value={lead.phone} />
        <Row label="Product" value={lead.product} />
        <Row label="Source" value={lead.source} />
        <Row label="Received" value={formatDateTime(lead.created_on)} />
        <Row label="Came from" value={ORIGIN_LABELS[lead.origin] || lead.origin} />
        {lead.is_repeat ? (
          <Row
            label="Repeat"
            value={`Enquiry #${lead.enquiry_number} from this number (first: ${lead.repeat_of})`}
            highlight
          />
        ) : null}

        <Pressable
          onPress={() => Linking.openURL(`tel:${lead.phone}`)}
          style={({ pressed }) => [styles.callBtn, pressed && styles.callBtnPressed]}
        >
          <Text style={styles.callText}>📞 Call {lead.phone}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Change status</Text>
        <Text style={styles.muted}>Updates the website dashboard at once.</Text>
        <View style={styles.statusGrid}>
          {STATUS_VALUES.map((s) => {
            const on = s === lead.status;
            const c = statusColors[s];
            return (
              <Pressable
                key={s}
                onPress={() => changeStatus(s)}
                disabled={on || !!saving}
                style={[
                  styles.statusBtn,
                  { borderColor: c },
                  on && { backgroundColor: c },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                {saving === s ? (
                  <ActivityIndicator color={c} />
                ) : (
                  <Text style={[styles.statusText, { color: on ? colors.paper : c }]}>
                    {on ? `✓ ${s}` : s}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
        {note ? (
          <Text style={note.kind === "ok" ? styles.success : styles.error}>{note.text}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Row({ label, value, highlight }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flexShrink: 1, fontSize: 22, fontWeight: "800", color: colors.ink },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 13, fontWeight: "700" },
  dealerBox: {
    marginTop: 14,
    marginBottom: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.turmericTint,
    borderWidth: 1,
    borderColor: colors.turmeric,
  },
  dealerLabel: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  dealerName: { fontSize: 17, fontWeight: "800", color: colors.ink, marginTop: 2 },
  dealerHint: { fontSize: 13, color: colors.muted, marginTop: 2 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { flexShrink: 1, fontSize: 14, color: colors.ink, fontWeight: "600", textAlign: "right" },
  rowHighlight: { color: colors.turmericDark },
  callBtn: {
    marginTop: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.slate,
    paddingVertical: 12,
    alignItems: "center",
  },
  callBtnPressed: { backgroundColor: colors.leafBg },
  callText: { fontSize: 15, fontWeight: "700", color: colors.slate },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  statusBtn: {
    flexGrow: 1,
    flexBasis: "45%",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  statusText: { fontSize: 15, fontWeight: "700" },
  success: { color: colors.leaf, fontSize: 14, marginTop: 12, fontWeight: "600" },
  error: { color: colors.chilli, fontSize: 14, marginTop: 12, textAlign: "center" },
});
