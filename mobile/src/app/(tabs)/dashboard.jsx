// dashboard.jsx - live Dashboard
//
// The phone version of the website's dashboard: counts by status, a bar per
// dealer, then every lead with status filters. Tap a lead to open it.
//
// One Firestore listener (onSnapshot), newest first. When anyone adds a lead
// or changes a status, on the phone OR on the website, this screen updates
// by itself. The first load reads every lead once; after that Firestore
// sends only the documents that changed.
//
// AI briefing: only COUNTS go to the AI server, never names or phone numbers,
// and dealer rankings are worked out here in code, not by the AI.

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { collection, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, DEALERS_COLLECTION, LEADS_COLLECTION } from "../../lib/firebase";
import { INHOUSE_DEALER, produceEmoji, STATUS_VALUES } from "../../lib/shared";
import { colors, radius, statusColors } from "../../lib/theme";
import { aiPost, WAKING_UP } from "../../lib/ai";

const FILTERS = ["All", ...STATUS_VALUES];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Same numbers the website's briefing sends (public/dashboard.js buildStats). */
function buildStats(leads) {
  const now = Date.now();
  const byStatus = {};
  STATUS_VALUES.forEach((s) => (byStatus[s] = 0));
  const byDealer = {};
  const byOrigin = {};
  const phoneCounts = {};
  let newOlderThan7Days = 0;
  let addedLast7Days = 0;

  leads.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const dealer = l.dealer_name || "Unassigned";
    byDealer[dealer] = (byDealer[dealer] || 0) + 1;
    const origin = l.origin || "unknown";
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;
    if (l.phone) phoneCounts[l.phone] = (phoneCounts[l.phone] || 0) + 1;

    const created = l.created_on && l.created_on.toDate ? l.created_on.toDate().getTime() : null;
    if (created && now - created <= 7 * DAY_MS) addedLast7Days += 1;
    if (created && l.status === "New" && now - created > 7 * DAY_MS) newOlderThan7Days += 1;
  });

  const dealersRanked = Object.entries(byDealer)
    .filter(([name]) => name !== INHOUSE_DEALER.dealer_name)
    .sort((a, b) => b[1] - a[1])
    .map(([dealer, count]) => ({ dealer, leads: count }));

  return {
    total_leads: leads.length,
    by_status: byStatus,
    dealers_ranked_busiest_first: dealersRanked,
    in_house_sales_leads: byDealer[INHOUSE_DEALER.dealer_name] || 0,
    by_origin: byOrigin,
    repeat_customers: Object.values(phoneCounts).filter((n) => n > 1).length,
    added_last_7_days: addedLast7Days,
    new_leads_waiting_over_7_days: newOlderThan7Days,
  };
}

/** "2 Nov 2026"; a lead saved a moment ago may not have its server time yet. */
function formatDate(ts) {
  if (!ts || typeof ts.toDate !== "function") return "Just now";
  return ts.toDate().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DashboardScreen() {
  const router = useRouter();
  const [leads, setLeads] = useState(null); // null = still loading
  const [dealers, setDealers] = useState([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [brief, setBrief] = useState(null);      // { kind: "ok" | "error" | "info", text }
  const [briefBusy, setBriefBusy] = useState(false);

  async function summarize() {
    if (!leads || leads.length === 0) {
      setBrief({ kind: "info", text: "There are no leads to summarize yet." });
      return;
    }
    setBriefBusy(true);
    setBrief({ kind: "info", text: "Reading the numbers…" });
    try {
      const data = await aiPost("/summary", { stats: buildStats(leads) }, {
        onSlow: () => setBrief({ kind: "info", text: WAKING_UP }),
      });
      setBrief({ kind: "ok", text: data.summary });
    } catch (err) {
      setBrief({ kind: "error", text: err.message });
    } finally {
      setBriefBusy(false);
    }
  }

  useEffect(() => {
    // Dealers rarely change: read once, only so a dealer with 0 leads still shows.
    getDocs(collection(db, DEALERS_COLLECTION))
      .then((snap) => setDealers(snap.docs.map((d) => d.data())))
      .catch(() => {});

    const q = query(collection(db, LEADS_COLLECTION), orderBy("created_on", "desc"));
    const stop = onSnapshot(
      q,
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })));
        setError("");
      },
      (err) => setError(`Could not load leads: ${err.message}`)
    );
    return stop; // stop listening when the screen goes away
  }, []);

  const counts = useMemo(() => {
    const c = { All: leads?.length || 0 };
    STATUS_VALUES.forEach((s) => (c[s] = 0));
    (leads || []).forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
    return c;
  }, [leads]);

  /** Busiest dealer first; In-house Sales always last, like the website. */
  const byDealer = useMemo(() => {
    const map = new Map();
    dealers.forEach((d) => map.set(d.dealer_name, 0));
    (leads || []).forEach((l) => map.set(l.dealer_name, (map.get(l.dealer_name) || 0) + 1));
    const rows = [...map.entries()].map(([name, count]) => ({ name, count }));
    const inhouse = rows.filter((r) => r.name === INHOUSE_DEALER.dealer_name);
    const others = rows
      .filter((r) => r.name !== INHOUSE_DEALER.dealer_name)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return [...others, ...inhouse];
  }, [leads, dealers]);

  const shown = useMemo(
    () => (leads || []).filter((l) => filter === "All" || l.status === filter),
    [leads, filter]
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (leads === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.slate} />
        <Text style={styles.muted}>Loading leads…</Text>
      </View>
    );
  }

  const maxBar = Math.max(1, ...byDealer.map((d) => d.count));

  const header = (
    <View style={{ gap: 12 }}>
      {/* Status tiles */}
      <View style={styles.tiles}>
        <View style={[styles.tile, styles.tileTotal]}>
          <Text style={styles.tileNumTotal}>{counts.All}</Text>
          <Text style={styles.tileLabelTotal}>Total leads</Text>
        </View>
        {STATUS_VALUES.map((s) => (
          <View key={s} style={[styles.tile, { borderLeftColor: statusColors[s] }]}>
            <Text style={[styles.tileNum, { color: statusColors[s] }]}>{counts[s]}</Text>
            <Text style={styles.tileLabel}>{s}</Text>
          </View>
        ))}
      </View>

      {/* AI briefing */}
      <View style={[styles.card, styles.briefCard]}>
        <View style={styles.briefHead}>
          <Text style={styles.cardTitle}>✨ AI briefing</Text>
          <Pressable
            onPress={summarize}
            disabled={briefBusy}
            style={({ pressed }) => [styles.briefBtn, (pressed || briefBusy) && { opacity: 0.85 }]}
          >
            {briefBusy ? (
              <ActivityIndicator color={colors.chalk} />
            ) : (
              <Text style={styles.briefBtnText}>{brief?.kind === "ok" ? "Again" : "Summarize"}</Text>
            )}
          </Pressable>
        </View>
        <Text style={[styles.briefText, brief?.kind === "error" && styles.briefError, (!brief || brief.kind === "info") && styles.briefMuted]}>
          {brief ? brief.text : "A short summary of these numbers and one next step. Only counts are sent, never names or phone numbers."}
        </Text>
      </View>

      {/* Leads by dealer */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Leads by dealer</Text>
        {byDealer.map((d) => (
          <View key={d.name} style={styles.barRow}>
            <Text style={styles.barName} numberOfLines={1}>
              {produceEmoji(d.name)} {d.name}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(d.count / maxBar) * 100}%` }]} />
            </View>
            <Text style={styles.barCount}>{d.count}</Text>
          </View>
        ))}
      </View>

      {/* Filters */}
      <Text style={styles.cardTitle}>All leads</Text>
      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const on = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filter, on && styles.filterOn]}>
              <Text style={[styles.filterText, on && styles.filterTextOn]}>
                {f} {counts[f] ?? 0}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <FlatList
      data={shown}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={styles.muted}>No {filter === "All" ? "" : filter} leads yet.</Text>}
      renderItem={({ item }) => (
        <LeadRow lead={item} onPress={() => router.push(`/lead/${item.id}`)} />
      )}
    />
  );
}

function LeadRow({ lead, onPress }) {
  const emoji = produceEmoji(lead.name);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowTop}>
        <Text style={styles.name} numberOfLines={1}>
          {emoji ? `${emoji} ` : ""}{lead.name}
        </Text>
        <StatusBadge status={lead.status} />
      </View>
      <Text style={styles.dealer} numberOfLines={1}>
        {produceEmoji(lead.dealer_name)} {lead.dealer_name} · {lead.pincode}
      </Text>
      <View style={styles.rowBottom}>
        <Text style={styles.meta} numberOfLines={1}>
          {lead.product} · {formatDate(lead.created_on)}
        </Text>
        {lead.is_repeat ? <Text style={styles.repeat}>Repeat ×{lead.enquiry_number}</Text> : null}
      </View>
    </Pressable>
  );
}

function StatusBadge({ status }) {
  const c = statusColors[status] || colors.muted;
  return (
    <View style={[styles.badge, { borderColor: c }]}>
      <Text style={[styles.badgeText, { color: c }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 16 },
  error: { color: colors.chilli, fontSize: 14, textAlign: "center" },
  list: { padding: 16, paddingBottom: 32, gap: 10 },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tileTotal: { flexBasis: "100%", backgroundColor: colors.slate, borderColor: colors.slate, borderLeftColor: colors.turmeric },
  tileNum: { fontSize: 24, fontWeight: "800" },
  tileLabel: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  tileNumTotal: { fontSize: 28, fontWeight: "800", color: colors.chalk },
  tileLabelTotal: { fontSize: 13, color: "#b9c2b4", fontWeight: "600" },

  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  briefCard: { borderColor: colors.turmeric, backgroundColor: colors.turmericTint },
  briefHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  briefBtn: {
    backgroundColor: colors.slate,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 104,
    alignItems: "center",
  },
  briefBtnText: { color: colors.chalk, fontWeight: "800", fontSize: 14 },
  briefText: { fontSize: 14, lineHeight: 21, color: colors.ink },
  briefMuted: { color: colors.muted },
  briefError: { color: colors.chilli },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barName: { width: 150, fontSize: 13, color: colors.ink },
  barTrack: { flex: 1, height: 10, borderRadius: 999, backgroundColor: "#eef2ea", overflow: "hidden" },
  barFill: { height: 10, borderRadius: 999, backgroundColor: colors.leaf },
  barCount: { width: 24, textAlign: "right", fontSize: 13, fontWeight: "800", color: colors.ink },

  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 2 },
  filter: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterOn: { backgroundColor: colors.slate, borderColor: colors.slate },
  filterText: { fontSize: 13, color: colors.ink },
  filterTextOn: { color: colors.chalk, fontWeight: "700" },

  row: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 4,
  },
  rowPressed: { backgroundColor: colors.turmericTint },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colors.ink },
  dealer: { fontSize: 14, color: colors.ink },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { flexShrink: 1, fontSize: 13, color: colors.muted },
  repeat: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.turmericDark,
    backgroundColor: colors.turmericTint,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: "700" },
});
