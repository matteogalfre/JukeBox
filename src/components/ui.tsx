// Briques d'interface partagées.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { colors, fonts, gradients, radius, space } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// Retours haptiques discrets : les « ticks » système d'Android.
export function tap(kind: 'select' | 'confirm' = 'select') {
  if (Platform.OS === 'web') return;
  const run =
    Platform.OS === 'android'
      ? () => Haptics.performAndroidHapticsAsync(kind === 'confirm' ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Segment_Tick)
      : () => (kind === 'confirm' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft) : Haptics.selectionAsync());
  run().catch(() => undefined);
}

// Logo : deux cartes empilées, celle de devant avec un bouton lecture (le tri du lundi).
// Même dessin que assets/logo/logo.svg.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width="64" height="64" rx="18" fill={colors.accent} />
      <G transform="translate(-1.5 -1.5)">
        <G transform="rotate(-13 32 34)">
          <Rect x="17" y="13" width="28" height="38" rx="7" fill={colors.onAccent} fillOpacity={0.32} />
        </G>
        <G transform="rotate(9 34 34)">
          <Rect x="21" y="14" width="28" height="38" rx="7" fill={colors.onAccent} />
          <Path d="M30.5 26.2 Q30.5 24.6 31.9 25.4 L42 32 Q43.3 33 42 34 L31.9 40.6 Q30.5 41.4 30.5 39.8 Z" fill={colors.accent} />
        </G>
      </G>
    </Svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <View style={styles.wordmark}>
      <LogoMark size={size + 12} />
      <Text style={[styles.wordmarkText, { fontSize: size + 2 }]}>jukebox</Text>
    </View>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.pageTitle, { paddingTop: insets.top + 18 }]}>
      <View style={styles.pageTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitleText} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.pageSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', gap: 10 }}>{right}</View> : null}
      </View>
    </View>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  size = 22,
  color = colors.text,
  style,
  tint,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, tint ? { backgroundColor: tint } : null, pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }, style]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function PrimaryButton({ label, icon, onPress, disabled, compact, style }: { label: string; icon?: IconName; onPress?: () => void; disabled?: boolean; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
      <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, compact && styles.buttonCompact]}>
        {icon && <Ionicons name={icon} size={compact ? 18 : 20} color={colors.onAccent} />}
        <Text style={[styles.buttonText, compact && { fontSize: 15 }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function Button({ label, icon, onPress, disabled, compact, style }: { label: string; icon?: IconName; onPress?: () => void; disabled?: boolean; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, styles.buttonSurface, compact && styles.buttonCompact, disabled && { opacity: 0.5 }, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }, style]}
    >
      {icon && <Ionicons name={icon} size={compact ? 18 : 20} color={colors.text} />}
      <Text style={[styles.buttonText, { color: colors.text }, compact && { fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.8 }]}>
      <Text style={[styles.chipText, active && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, right, style }: { title: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionTitle} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

export function Empty({ icon = 'musical-notes-outline', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkText: { fontFamily: fonts.displayHeavy, color: colors.text, letterSpacing: -0.9 },
  pageTitle: { paddingHorizontal: space.page, paddingBottom: 16 },
  pageTitleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  pageTitleText: { fontFamily: fonts.displayHeavy, fontSize: 36, color: colors.text, letterSpacing: -1 },
  pageSubtitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, marginTop: 2 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, paddingHorizontal: 22, borderRadius: radius.pill },
  buttonSurface: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.stroke },
  buttonCompact: { height: 44, paddingHorizontal: 16 },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.onAccent },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 12, gap: 12 },
  sectionTitle: { flex: 1, fontFamily: fonts.display, fontSize: 21, color: colors.text, letterSpacing: -0.3 },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 56, gap: 8 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.text, textAlign: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});
