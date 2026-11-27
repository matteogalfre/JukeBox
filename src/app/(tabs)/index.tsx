// La sélection de la semaine.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Acces, { useAccess } from '../../components/Acces';
import BatchView from '../../components/BatchView';
import { Empty, PrimaryButton, Wordmark } from '../../components/ui';
import { demoMode, ensureWeek, refresh, regenerate, WEEKLY_COUNT } from '../../lib/semaine';
import { colors, fonts, space, TAB_BAR_SPACE } from '../../theme';

function weekLabel(batch: string) {
  const d = new Date(`${batch.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default function Semaine() {
  const insets = useSafeAreaInsets();
  const { state: access, check } = useAccess();
  const [week, setWeek] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = !!access && access.music;

  const prepare = useCallback(async () => {
    setError(null);
    setProgress('Préparation de la sélection');
    try {
      setWeek(await ensureWeek(setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }, []);

  const again = useCallback(async () => {
    setError(null);
    setProgress('Nouvelle sélection');
    try {
      setWeek(await regenerate(setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      refresh().catch(() => undefined);
      if (!week) prepare();
    }, [ready, week, prepare]),
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: TAB_BAR_SPACE + insets.bottom, paddingHorizontal: space.page }}
        showsVerticalScrollIndicator={false}
      >
        <Wordmark />

        {access && !ready ? (
          <>
            <Text style={styles.h1}>Ta sélection du lundi</Text>
            <Text style={styles.lead}>
              Chaque lundi, {WEEKLY_COUNT} titres choisis d'après ce que tu écoutes dans Samsung Music. Tu écoutes les extraits,
              tu gardes ce qui te plaît, et les titres arrivent dans ta musique.
            </Text>
            <Acces state={access} onChange={check} />
          </>
        ) : (
          <>
            <Text style={styles.h1}>Cette semaine</Text>
            <Text style={styles.lead}>{week ? (week.includes('+') ? `Nouvelle sélection, semaine du ${weekLabel(week)}` : `Sélection du ${weekLabel(week)}`) : demoMode ? 'Démo' : ' '}</Text>
            {progress ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>{progress}</Text>
                <Text style={styles.loadingHint}>Environ une minute la première fois</Text>
              </View>
            ) : error ? (
              <Empty icon="cloud-offline-outline" title="Sélection indisponible" text={error} action={<PrimaryButton label="Réessayer" compact onPress={prepare} style={{ marginTop: 12 }} />} />
            ) : week ? (
              <BatchView key={week} batch={week} onAgain={again} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  h1: { fontFamily: fonts.displayHeavy, fontSize: 36, color: colors.text, letterSpacing: -1, marginTop: 22 },
  lead: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, marginTop: 2, marginBottom: 18, lineHeight: 20 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 80 },
  loadingText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  loadingHint: { fontFamily: fonts.regular, fontSize: 13, color: colors.dim },
});
