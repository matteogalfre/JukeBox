// Sélection à la demande : un artiste ou un titre, 10 extraits dans le même style.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BatchView from '../../components/BatchView';
import { Empty, PageTitle } from '../../components/ui';
import { discover, SEARCH_COUNT } from '../../lib/semaine';
import { colors, fonts, radius, space, TAB_BAR_SPACE } from '../../theme';

export default function Chercher() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [batch, setBatch] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (again?: string) => {
    const q = (again ?? query).trim();
    if (!q || progress) return;
    Keyboard.dismiss();
    setError(null);
    setBatch(null);
    setProgress('Recherche');
    try {
      setBatch(await discover(q, setProgress));
      setLabel(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.screen}>
      <PageTitle title="Chercher" subtitle={`${SEARCH_COUNT} titres dans le style d'un artiste ou d'un morceau`} />
      <View style={styles.search}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => go()}
          placeholder="Artiste ou titre…"
          placeholderTextColor={colors.dim}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Effacer">
            <Ionicons name="close-circle" size={18} color={colors.dim} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.page, paddingTop: 18, paddingBottom: TAB_BAR_SPACE + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {progress ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>{progress}</Text>
          </View>
        ) : error ? (
          <Empty icon="search-outline" title="Rien trouvé" text={error} />
        ) : batch ? (
          <>
            <Text style={styles.context}>Dans le style de {label}</Text>
            <BatchView key={batch} batch={batch} onAgain={() => go(label)} againLabel="Encore 10 titres" />
          </>
        ) : (
          <Empty icon="disc-outline" title="Un artiste que tu aimes ?" text="Tape son nom ou un de ses titres. Tu recevras des extraits de morceaux proches." />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
    marginHorizontal: space.page,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, paddingVertical: 0 },
  context: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, marginBottom: 14 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 80 },
  loadingText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
});
