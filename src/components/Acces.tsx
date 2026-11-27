// Les autorisations dont l'appli a besoin, avec un bouton pour chacune.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ecoute from '../../modules/ecoute';
import { scheduleMonday } from '../lib/semaine';
import { colors, fonts, radius } from '../theme';
import type { IconName } from './ui';

export type AccessState = { music: boolean; listening: boolean; battery: boolean; notifications: boolean };

const AUDIO = 'android.permission.READ_MEDIA_AUDIO' as const;

export async function readAccess(): Promise<AccessState> {
  if (Platform.OS !== 'android' || !Ecoute) return { music: true, listening: true, battery: true, notifications: true };
  const music = await PermissionsAndroid.check(AUDIO);
  const notif = await Notifications.getPermissionsAsync();
  return { music, listening: Ecoute.hasAccess(), battery: Ecoute.batteryUnrestricted(), notifications: notif.granted };
}

export function useAccess() {
  const [state, setState] = useState<AccessState | null>(null);
  const check = useCallback(() => {
    readAccess().then(setState).catch(() => undefined);
  }, []);
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [check]);
  return { state, check };
}

type Item = { key: keyof AccessState; icon: IconName; title: string; why: string; action: () => Promise<unknown> | void };

const ITEMS: Item[] = [
  {
    key: 'music',
    icon: 'musical-notes',
    title: 'Musique et audio',
    why: 'Pour ne pas te proposer ce que tu as déjà.',
    action: () => PermissionsAndroid.request(AUDIO),
  },
  {
    key: 'listening',
    icon: 'pulse',
    title: 'Accès aux notifications',
    why: 'Pour voir ce que joue Samsung Music : titre, artiste, temps d’écoute.',
    action: () => Ecoute?.openAccessSettings(),
  },
  {
    key: 'battery',
    icon: 'battery-charging',
    title: 'Batterie sans restriction',
    why: 'Sinon le suivi des écoutes s’arrête au bout de quelques jours.',
    action: () => Ecoute?.openBatterySettings(),
  },
  {
    key: 'notifications',
    icon: 'notifications',
    title: 'Rappel du lundi',
    why: 'Une notification à 8 h quand la sélection est prête.',
    action: () => scheduleMonday(),
  },
];

export default function Acces({ state, onChange }: { state: AccessState; onChange: () => void }) {
  return (
    <View style={styles.group}>
      {ITEMS.map((it, i) => {
        const ok = state[it.key];
        return (
          <Pressable
            key={it.key}
            disabled={ok}
            onPress={async () => {
              await it.action();
              setTimeout(onChange, 400);
            }}
            style={({ pressed }) => [styles.row, i > 0 && styles.sep, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.icon, { backgroundColor: ok ? colors.accentSoft : colors.surface2 }]}>
              <Ionicons name={ok ? 'checkmark' : it.icon} size={18} color={ok ? colors.accent : colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{it.title}</Text>
              <Text style={styles.why}>{it.why}</Text>
            </View>
            {!ok && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  sep: { borderTopWidth: 1, borderTopColor: colors.stroke },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  why: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
});
