// Une fournée : le tri tant qu'il reste des cartes, puis la liste des titres.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Telechargeur, { type DownloadStatus } from '../../modules/telechargeur';
import type { ProposalRow } from '../lib/db';
import { batchRows, decide, refresh, retry } from '../lib/semaine';
import { colors, fonts, radius } from '../theme';
import SwipeDeck from './SwipeDeck';
import { PrimaryButton, SectionHeader } from './ui';

export function useBatch(batch: string) {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const load = useCallback(async () => setRows(await batchRows(batch)), [batch]);
  useEffect(() => {
    load();
  }, [load]);

  // Suit les téléchargements tant que l'écran est ouvert.
  const waiting = rows.some((r) => r.dl_status === 'queued');
  const [live, setLive] = useState<Map<string, DownloadStatus>>(new Map());
  const [unmetered, setUnmetered] = useState(true);
  const [liveLoaded, setLiveLoaded] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const tick = async () => {
      await refresh().catch(() => undefined);
      await load();
      if (Telechargeur) {
        const list = await Telechargeur.status().catch(() => []);
        setLive(new Map(list.map((s) => [s.id, s])));
        setUnmetered(Telechargeur.networkIsUnmetered());
        setLiveLoaded(true);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [waiting, load]);

  return { rows, setRows, load, live, liveLoaded, unmetered };
}

export default function BatchView({ batch, onAgain, againLabel = 'Nouvelle sélection' }: { batch: string; onAgain?: () => void; againLabel?: string }) {
  const { rows, setRows, load, live, liveLoaded, unmetered } = useBatch(batch);
  const pending = rows.filter((r) => !r.decision);

  if (pending.length) {
    return (
      <SwipeDeck
        rows={pending}
        total={rows.length}
        onDecide={async (row, d, signal) => {
          setRows((all) => all.map((r) => (r.id === row.id ? { ...r, decision: d } : r)));
          await decide(row, d, signal).catch(() => undefined);
          load();
        }}
      />
    );
  }

  const kept = rows.filter((r) => r.decision === 'keep' || r.decision === 'have');
  const rejected = rows.filter((r) => r.decision === 'reject');
  return (
    <View>
      <View style={styles.stats}>
        <Stat value={kept.length} label="gardés" color={colors.accent} />
        <Stat value={kept.filter((r) => r.dl_status === 'done').length} label="dans ta musique" color={colors.sky} />
        <Stat value={rejected.length} label="passés" color={colors.muted} />
      </View>
      {onAgain && <PrimaryButton label={againLabel} icon="refresh" onPress={onAgain} style={{ marginTop: 14 }} />}
      {onAgain && <Text style={styles.hint}>Tient compte de ce que tu viens de garder ou de passer.</Text>}

      {!unmetered && kept.some((r) => r.dl_status === 'queued') && (
        <View style={styles.notice}>
          <Ionicons name="wifi" size={18} color={colors.gold} />
          <Text style={styles.noticeText}>
            Le réseau actuel n'est pas vu comme un Wi-Fi illimité. Les téléchargements partiront dès que ce sera le cas.
          </Text>
        </View>
      )}

      {kept.length > 0 && (
        <>
          <SectionHeader title="Gardés" />
          <View style={{ gap: 10 }}>
            {kept.map((r) => (
              <Row key={r.id} row={r} live={live.get(r.id)} liveLoaded={liveLoaded} onRetry={async () => { await retry(r); load(); }} />
            ))}
          </View>
        </>
      )}
      {rejected.length > 0 && (
        <>
          <SectionHeader title="Passés" />
          <View style={{ gap: 10 }}>
            {rejected.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ row, live, liveLoaded, onRetry }: { row: ProposalRow; live?: DownloadStatus; liveLoaded?: boolean; onRetry?: () => void }) {
  return (
    <View style={[styles.row, row.decision === 'reject' && { opacity: 0.5 }]}>
      <Image source={row.cover_medium || row.cover} style={styles.cover} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{row.artist}</Text>
        {row.dl_error && row.dl_status !== 'done' ? <Text style={styles.error} numberOfLines={2}>{row.dl_error}</Text> : null}
      </View>
      {row.decision !== 'reject' && <Status row={row} live={live} liveLoaded={liveLoaded} onRetry={onRetry} />}
    </View>
  );
}

function Status({ row, live, liveLoaded, onRetry }: { row: ProposalRow; live?: DownloadStatus; liveLoaded?: boolean; onRetry?: () => void }) {
  if (row.decision === 'have') return <Pill icon="checkmark-done" text="Déjà là" color={colors.sky} bg={colors.skySoft} />;
  if (row.outcome === 'library') return <Pill icon="library" text="Rangé" color={colors.accent} bg={colors.accentSoft} />;
  if (row.outcome === 'deleted') return <Pill icon="trash-outline" text="Supprimé" color={colors.muted} bg={colors.surface2} />;
  if (row.dl_status === 'done') return <Pill icon="checkmark" text="Prêt" color={colors.accent} bg={colors.accentSoft} />;
  if (row.dl_status === 'failed')
    return (
      <Pressable onPress={onRetry} hitSlop={8}>
        <Pill icon="refresh" text="Réessayer" color={colors.coral} bg={colors.coralSoft} />
      </Pressable>
    );
  if (row.dl_status === 'queued') {
    if (live?.state === 'RUNNING')
      return <Pill icon="download" text={live.step === 'prepare' ? 'Préparation' : 'Téléchargement'} color={colors.sky} bg={colors.skySoft} />;
    if (live?.state === 'ENQUEUED' && live.attempts > 0) return <Pill icon="time" text="Nouvel essai" color={colors.gold} bg={colors.goldSoft} />;
    if (live?.state === 'ENQUEUED') return <Pill icon="wifi" text="En file" color={colors.gold} bg={colors.goldSoft} />;
    // Plus suivi par Android (rare) : on propose de relancer.
    if (!live && liveLoaded)
      return (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Pill icon="refresh" text="Relancer" color={colors.coral} bg={colors.coralSoft} />
        </Pressable>
      );
    return <Pill icon="wifi" text="En file" color={colors.gold} bg={colors.goldSoft} />;
  }
  return null;
}

function Pill({ icon, text, color, bg }: { icon: keyof typeof Ionicons.glyphMap; text: string; color: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.dim, textAlign: 'center', marginTop: 8 },
  stat: { flex: 1, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke },
  statValue: { fontFamily: fonts.displayHeavy, fontSize: 28, letterSpacing: -0.5 },
  statLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke },
  cover: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  artist: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  error: { fontFamily: fonts.regular, fontSize: 12, color: colors.coral, marginTop: 3 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 14, borderRadius: radius.md, backgroundColor: colors.goldSoft },
  noticeText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.bold, fontSize: 11 },
});
