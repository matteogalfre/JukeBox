// Barre de navigation flottante : une pastille en dégradé glisse sous
// l'onglet actif.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Tabs } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, gradients } from '../theme';
import { tap, type IconName } from './ui';

export const TABS: Record<string, { label: string; icon: string }> = {
  index: { label: 'Semaine', icon: 'disc' },
  chercher: { label: 'Chercher', icon: 'search' },
  stats: { label: 'Stats', icon: 'stats-chart' },
  reglages: { label: 'Réglages', icon: 'settings' },
};

const PAD = 6;

// Les types d'onglets viennent d'Expo Router (sa copie de React Navigation).
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const activeIndex = Math.max(0, routes.findIndex((r) => r.key === state.routes[state.index].key));
  const [barW, setBarW] = useState(0);
  const slotW = barW ? (barW - PAD * 2) / routes.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    if (!slotW) return;
    const to = activeIndex * slotW;
    if (first.current) {
      x.setValue(to);
      first.current = false;
    } else {
      Animated.spring(x, { toValue: to, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.8 }).start();
    }
  }, [activeIndex, slotW, x]);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 4 }]}>
      <View style={styles.bar} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
        {slotW > 0 && (
          <Animated.View style={[styles.indicator, { width: slotW, transform: [{ translateX: x }] }]}>
            <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.indicatorFill} />
          </Animated.View>
        )}
        {routes.map((route, i) => {
          const tab = TABS[route.name];
          const focused = i === activeIndex;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              tap();
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              style={styles.item}
            >
              <Ionicons
                name={(focused ? tab.icon : `${tab.icon}-outline`) as IconName}
                size={21}
                color={focused ? colors.onAccent : colors.muted}
              />
              <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 460,
    height: 68,
    padding: PAD,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.bar,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  indicator: { position: 'absolute', top: PAD, bottom: PAD, left: PAD },
  indicatorFill: { flex: 1, borderRadius: 20 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.muted, letterSpacing: 0.1 },
  labelActive: { fontFamily: fonts.semibold, color: colors.onAccent },
});
