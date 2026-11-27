// Tes stats : tops, habitudes, bilan des découvertes.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Empty, PageTitle, SectionHeader } from '../../components/ui';
import { refresh } from '../../lib/semaine';
import { discoveryReport, habits, topArtists, topTracks, type DiscoveryReport, type Habits, type Period, type TopRow } from '../../lib/stats';
import { colors, fonts, radius, space, TAB_BAR_SPACE } from '../../theme';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: '7 jours' },
  { key: 'month', label: '30 jours' },
  { key: 'all', label: 'Tout' },
];
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function duration(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export default function Stats() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>('week');
  const [view, setView] = useState<'artists' | 'tracks'>('artists');
  const [data, setData] = useState<{ tracks: TopRow[]; artists: TopRow[]; h: Habits; rep: DiscoveryReport } | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        await refresh().catch(() => undefined);
        const [tracks, artists, h, rep] = await Promise.all([topTracks(period), topArtists(period), habits(period), discoveryReport(period)]);
        setData({ tracks, artists, h, rep });
      })();
    }, [period]),
  );

  const h = data?.h;
  const list = (view === 'tracks' ? data?.tracks : data?.artists) ?? [];
  const maxHour = Math.max(1, ...(h?.byHour ?? [1]));
  const maxDay = Math.max(1, ...(h?.byWeekday ?? [1]));
  const bestHour = h ? h.byHour.indexOf(Math.max(...h.byHour)) : 0;
  const rep = data?.rep;

  return (
    <View style={styles.screen}>
      <PageTitle title="Stats" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.page, paddingBottom: TAB_BAR_SPACE + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => setPeriod(p.key)} />
          ))}
        </View>

        {h && (
          <View style={styles.tiles}>
            <Tile value={duration(h.totalMs)} label="d'écoute" />
            <Tile value={String(h.listens)} label="titres écoutés" />
            <Tile value={h.listens + h.skips ? `${Math.round((100 * h.skips) / (h.listens + h.skips))} %` : '–'} label="passés vite" />
          </View>
        )}

        <SectionHeader
          title="Top"
          right={
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {(['artists', 'tracks'] as const).map((v) => (
                <Pressable key={v} onPress={() => setView(v)} hitSlop={8}>
                  <Text style={[styles.toggle, view === v && { color: colors.text }]}>{v === 'artists' ? 'Artistes' : 'Titres'}</Text>
                </Pressable>
              ))}
            </View>
          }
        />
        {list.length ? (
          <View style={styles.group}>
            {list.map((r, i) => (
              <View key={`${r.label}-${i}`} style={[styles.topRow, i > 0 && styles.sep]}>
                <Text style={[styles.rank, i < 3 && { color: colors.accent }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.topLabel} numberOfLines={1}>{r.label}</Text>
                  {r.sub ? <Text style={styles.topSub} numberOfLines={1}>{r.sub}</Text> : null}
                </View>
                <Text style={styles.count}>{r.count} écoute{r.count > 1 ? 's' : ''}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Empty icon="headset-outline" title="Pas encore d'écoute" text="Écoute de la musique dans Samsung Music, tes stats apparaîtront ici." />
        )}

        {h && h.totalMs > 0 && (
          <>
            <SectionHeader title="Habitudes" />
            <View style={[styles.group, { padding: 16 }]}>
              <Text style={styles.note}>
                Tu écoutes surtout vers <Text style={{ color: colors.text, fontFamily: fonts.semibold }}>{bestHour} h</Text>
              </Text>
              <View style={styles.bars}>
                {h.byHour.map((v, i) => (
                  <View key={i} style={styles.barCol}>
                    <View style={[styles.bar, { height: 4 + (64 * v) / maxHour, backgroundColor: i === bestHour ? colors.accent : colors.surface3 }]} />
                    <Text style={styles.barLabel}>{i % 6 === 0 ? `${i}h` : ' '}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.bars, { marginTop: 18 }]}>
                {h.byWeekday.map((v, i) => (
                  <View key={i} style={styles.barCol}>
                    <View style={[styles.bar, { height: 4 + (48 * v) / maxDay, backgroundColor: colors.sky, opacity: 0.3 + (0.7 * v) / maxDay }]} />
                    <Text style={styles.barLabel}>{DAYS[i]}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {rep && rep.proposed > 0 && (
          <>
            <SectionHeader title="Découvertes" />
            <View style={styles.group}>
              <Line label="Proposées" value={rep.proposed} first />
              <Line label="Gardées au tri" value={rep.kept} pct={rep.kept / Math.max(1, rep.kept + rep.rejected)} />
              <Line label="Téléchargées" value={rep.downloaded} />
              <Line label="Écoutées en entier ensuite" value={rep.listenedAfter} pct={rep.listenedAfter / Math.max(1, rep.downloaded)} />
              <Line label="Rangées dans ta musique" value={rep.inLibrary} />
              <Line label="Supprimées" value={rep.deleted} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Line({ label, value, pct, first }: { label: string; value: number; pct?: number; first?: boolean }) {
  return (
    <View style={[styles.line, !first && styles.sep]}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>
        {value}
        {pct !== undefined ? <Text style={styles.linePct}>{`  ${Math.round(pct * 100)} %`}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  chips: { flexDirection: 'row', gap: 8 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: { flex: 1, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke },
  tileValue: { fontFamily: fonts.displayHeavy, fontSize: 24, color: colors.text, letterSpacing: -0.5 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
  toggle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.dim },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke, overflow: 'hidden' },
  sep: { borderTopWidth: 1, borderTopColor: colors.stroke },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  rank: { width: 22, fontFamily: fonts.displayHeavy, fontSize: 18, color: colors.dim },
  topLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  topSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 1 },
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  note: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginBottom: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  bar: { width: '100%', borderRadius: 3 },
  barLabel: { fontFamily: fonts.medium, fontSize: 10, color: colors.dim },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  lineLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  lineValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  linePct: { fontFamily: fonts.semibold, color: colors.accent },
});
