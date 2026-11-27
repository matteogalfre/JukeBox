// Le tri : l'extrait démarre tout seul, glisse à droite pour garder, à gauche pour passer.
// Toucher la carte met en pause.
//
// Pendant le tri, l'appli garde un focus audio durable (module ecoute) : Samsung Music reste en
// pause au lieu de reprendre entre deux extraits.
import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Linking, PanResponder, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ecoute from '../../modules/ecoute';
import type { Decision, ProposalRow } from '../lib/db';
import { previewUrl } from '../lib/semaine';
import { colors, fonts, gradients, radius, space, TAB_BAR_SPACE } from '../theme';
import { IconButton, tap } from './ui';

type Props = {
  rows: ProposalRow[];
  total: number;
  onDecide: (row: ProposalRow, decision: Decision, signal: SwipeSignal) => void;
};

/** Ce que le tri dit en plus de la décision : secondes d'extrait écoutées, ouverture sur YouTube. */
export type SwipeSignal = { heardS: number; youtube: boolean };

// Liens d'extrait déjà demandés (la carte suivante est préparée pendant qu'on écoute celle-ci).
const urls = new Map<string, Promise<string | null>>();
function link(id: string) {
  let p = urls.get(id);
  if (!p) {
    p = previewUrl(id).catch(() => null);
    urls.set(id, p);
    // Un échec n'est pas gardé : on retentera à la prochaine carte.
    p.then((u) => !u && urls.delete(id));
  }
  return p;
}

function holdFocus(on: boolean) {
  try { Ecoute?.holdFocus(on); } catch { /* module plus ancien : pas grave */ }
}

const THRESHOLD = 110;

function badge(row: ProposalRow) {
  if (row.source === 'search') return row.kind === 'known' ? 'DE CET ARTISTE' : 'MÊME STYLE';
  return row.kind === 'known' ? 'TU CONNAIS' : 'NOUVEL ARTISTE';
}

export default function SwipeDeck({ rows, total, onDecide }: Props) {
  const { width, height } = useWindowDimensions();
  const cardW = Math.min(width, 520) - space.page * 2;
  // Titre de page, boutons et barre d'onglets doivent tenir sans défiler.
  const cardH = Math.max(300, Math.min(Math.round(cardW * 1.22), height - TAB_BAR_SPACE - 250));
  const pos = useRef(new Animated.ValueXY()).current;
  const [busy, setBusy] = useState(false);
  const current = rows[0];
  const next = rows[1];

  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [previewError, setPreviewError] = useState(false);
  // Le plus loin écouté dans l'extrait de la carte en cours, et le passage par YouTube.
  const heard = useRef(0);
  const youtube = useRef(false);

  const start = () => {
    holdFocus(true);
    player.play();
  };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' }).catch(() => undefined);
    // L'appli passe en arrière-plan : on rend la main (l'extrait est coupé par expo-audio).
    const sub = AppState.addEventListener('change', (state) => state !== 'active' && holdFocus(false));
    // Pas de pause ici : au démontage, le lecteur est déjà libéré (y toucher fait planter Android).
    return () => {
      sub.remove();
      holdFocus(false);
    };
  }, []);

  // Nouvel extrait à chaque carte (lien rafraîchi : ceux de Deezer expirent), et on prépare le suivant.
  useEffect(() => {
    let cancelled = false;
    setPreviewError(false);
    heard.current = 0;
    youtube.current = false;
    if (!current) return;
    link(current.id).then((url) => {
      if (cancelled) return;
      if (!url) return setPreviewError(true);
      player.replace({ uri: url });
      start();
    });
    if (next) link(next.id);
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  useEffect(() => {
    if (status.currentTime > heard.current) heard.current = status.currentTime;
    if (status.didJustFinish && status.duration > 0) heard.current = status.duration;
  }, [status.currentTime, status.didJustFinish]);

  const fling = (decision: Decision) => {
    if (!current || busy) return;
    setBusy(true);
    // L'extrait s'arrête tout de suite, pas quand celui de la carte suivante est prêt.
    try { player.pause(); } catch { /* lecteur déjà libéré */ }
    const signal: SwipeSignal = { heardS: Math.round(heard.current), youtube: youtube.current };
    tap(decision === 'reject' ? 'select' : 'confirm');
    // « J'ai déjà » part vers le haut, les deux autres sur les côtés.
    const to = decision === 'have' ? { x: 0, y: -height } : { x: (decision === 'keep' ? 1 : -1) * (width + 120), y: 30 };
    Animated.timing(pos, {
      toValue: to,
      duration: 220,
      // Même mode que le glisser au doigt (JS) : mélanger les deux fait planter Android.
      useNativeDriver: false,
    }).start(() => {
      pos.setValue({ x: 0, y: 0 });
      setBusy(false);
      onDecide(current, decision, signal);
    });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          if (g.dx > THRESHOLD) fling('keep');
          else if (g.dx < -THRESHOLD) fling('reject');
          else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
        },
      }),
    [current?.id, busy],
  );

  if (!current) return null;

  const rotate = pos.x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-12deg', '0deg', '12deg'] });
  const keepOpacity = pos.x.interpolate({ inputRange: [20, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const rejectOpacity = pos.x.interpolate({ inputRange: [-THRESHOLD, -20], outputRange: [1, 0], extrapolate: 'clamp' });
  const nextScale = pos.x.interpolate({ inputRange: [-width, 0, width], outputRange: [1, 0.95, 1], extrapolate: 'clamp' });
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const index = total - rows.length + 1;

  // Extrait fini : on repart du début (sinon « lecture » ne fait rien, on est déjà à la fin).
  const toggle = () => {
    if (status.playing) return player.pause();
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.5)) player.seekTo(0);
    start();
  };

  const openYoutube = () => {
    player.pause();
    youtube.current = true;
    const q = encodeURIComponent(`${current.artist} ${current.title}`);
    Linking.openURL(`https://www.youtube.com/results?search_query=${q}`);
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: cardW, height: cardH }}>
        {next && (
          <Animated.View style={[styles.card, { width: cardW, height: cardH, opacity: 0.55, transform: [{ scale: nextScale }] }]}>
            <Image source={next.cover} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Animated.View>
        )}
        <Animated.View
          {...pan.panHandlers}
          style={[styles.card, { width: cardW, height: cardH, transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={toggle}>
            <Image source={current.cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            <LinearGradient colors={gradients.scrimBottom} locations={[0.4, 0.68, 1]} style={StyleSheet.absoluteFill} />

            <View style={styles.top}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge(current)}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{index} / {total}</Text>
              </View>
            </View>

            {!status.playing && status.isLoaded && (
              <View style={styles.center} pointerEvents="none">
                <View style={styles.playBubble}>
                  <Ionicons name="play" size={30} color={colors.text} style={{ marginLeft: 3 }} />
                </View>
              </View>
            )}

            <Animated.View style={[styles.stamp, styles.stampKeep, { opacity: keepOpacity }]}>
              <Ionicons name="heart" size={22} color={colors.accent} />
              <Text style={[styles.stampText, { color: colors.accent }]}>Je garde</Text>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampReject, { opacity: rejectOpacity }]}>
              <Ionicons name="close" size={22} color={colors.coral} />
              <Text style={[styles.stampText, { color: colors.coral }]}>Pas pour moi</Text>
            </Animated.View>

            <View style={styles.bottom}>
              <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>{[current.artist, current.album].filter(Boolean).join(' · ')}</Text>
              <Text style={styles.reason} numberOfLines={1}>
                {current.reason.includes(' · ') ? current.reason : [current.genre, current.reason].filter(Boolean).join('  ·  ')}
              </Text>
              {previewError ? <Text style={styles.reason}>Extrait indisponible. Écoute-le sur YouTube.</Text> : null}
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            </View>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.actions}>
        <IconButton icon="close" label="Pas pour moi" size={30} color={colors.coral} style={styles.big} onPress={() => fling('reject')} />
        <IconButton icon="logo-youtube" label="Écouter en entier sur YouTube" size={20} color={colors.muted} onPress={openYoutube} style={styles.small} />
        <IconButton icon="checkmark-done" label="J'ai déjà ce titre" size={22} color={colors.sky} onPress={() => fling('have')} style={styles.small} />
        <Pressable accessibilityLabel="Je garde" onPress={() => fling('keep')} style={({ pressed }) => pressed && { transform: [{ scale: 0.94 }] }}>
          <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.big, styles.keep]}>
            <Ionicons name="heart" size={28} color={colors.onAccent} />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 0,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', margin: 16 },
  badge: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.scrim },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, color: colors.text },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playBubble: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
  },
  stamp: {
    position: 'absolute',
    top: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.scrimStrong,
  },
  stampKeep: { left: 16 },
  stampReject: { right: 16 },
  stampText: { fontFamily: fonts.bold, fontSize: 15 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, paddingBottom: 20 },
  title: { fontFamily: fonts.displayHeavy, fontSize: 28, lineHeight: 31, color: colors.text, letterSpacing: -0.6 },
  meta: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, marginTop: 6, opacity: 0.9 },
  reason: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 6 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.stroke },
  trackFill: { height: 3, backgroundColor: colors.accent },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 18 },
  big: { width: 64, height: 64, borderRadius: 32 },
  small: { width: 48, height: 48, borderRadius: 24 },
  keep: { alignItems: 'center', justifyContent: 'center' },
});
