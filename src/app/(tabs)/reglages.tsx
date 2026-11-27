// Réglages : accès, fonctionnement, moteur de téléchargement.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Telechargeur from '../../../modules/telechargeur';
import Acces, { useAccess } from '../../components/Acces';
import { Button, PageTitle, SectionHeader, type IconName } from '../../components/ui';
import { db, getMeta, setMeta } from '../../lib/db';
import { validateToken } from '../../lib/listenbrainz';
import { cleanup, demoMode, refresh, WEEKLY_COUNT } from '../../lib/semaine';
import { colors, fonts, radius, space, TAB_BAR_SPACE } from '../../theme';

export default function Reglages() {
  const insets = useSafeAreaInsets();
  const { state, check } = useAccess();
  const [engine, setEngine] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [counts, setCounts] = useState<{ listens: number; library: number } | null>(null);

  useEffect(() => {
    Telechargeur?.engineVersion().then(setEngine).catch(() => setEngine(null));
    (async () => {
      await refresh().catch(() => undefined);
      const d = await db();
      const l = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM listens');
      const b = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM library');
      setCounts({ listens: l?.n ?? 0, library: b?.n ?? 0 });
    })();
  }, []);

  const update = async () => {
    if (!Telechargeur) return;
    setUpdating(true);
    try {
      const r = await Telechargeur.updateEngine();
      setEngine(r.version);
      Alert.alert('yt-dlp', r.status === 'DONE' ? `Mis à jour en ${r.version}.` : 'Déjà à jour.');
    } catch (e) {
      Alert.alert('yt-dlp', `La mise à jour a échoué : ${(e as Error).message}`);
    } finally {
      setUpdating(false);
    }
  };

  const tidy = async () => {
    const r = await cleanup();
    Alert.alert('Ménage', `${r.kept} titre(s) rangé(s), ${r.deleted} supprimé(s).`);
  };

  return (
    <View style={styles.screen}>
      <PageTitle title="Réglages" subtitle={demoMode ? 'Démo : rien n’est suivi ni téléchargé' : undefined} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.page, paddingBottom: TAB_BAR_SPACE + insets.bottom }} showsVerticalScrollIndicator={false}>
        {state && <Acces state={state} onChange={check} />}

        <SectionHeader title="Fonctionnement" />
        <View style={styles.group}>
          <Row icon="calendar" label="Sélection" value={`${WEEKLY_COUNT} titres, lundi 8 h`} first />
          <Row icon="radio" label="Lecteur suivi" value="Samsung Music" />
          <Row icon="git-branch" label="Mélange" value="70 % de nouveaux" />
          <Row icon="musical-note" label="Format" value="mp3 320 kbit/s" />
          <Row icon="wifi" label="Téléchargement" value="Wi-Fi seulement" />
          <Row icon="folder" label="Dossier" value="Music/JukeBox/Découvertes" />
          {counts && <Row icon="pulse" label="Écoutes enregistrées" value={String(counts.listens)} />}
          {counts && <Row icon="phone-portrait" label="Titres sur le téléphone" value={String(counts.library)} />}
        </View>
        <Text style={styles.foot}>
          Le lundi suivant, un titre écouté en entier deux fois est rangé dans Music/JukeBox. Écouté une fois, il reste une
          semaine de plus. Jamais écouté en entier, il est supprimé.
        </Text>

        <ListenBrainz />

        <SectionHeader title="Téléchargement" />
        <View style={styles.group}>
          <Row icon="logo-youtube" label="yt-dlp" value={engine ?? '–'} first />
        </View>
        <Text style={styles.foot}>Si les téléchargements échouent, YouTube a sûrement changé quelque chose : mets à jour yt-dlp.</Text>
        <View style={styles.actions}>
          <Button label={updating ? 'Mise à jour…' : 'Mettre à jour'} icon="refresh" compact onPress={update} disabled={updating || !Telechargeur} />
          <Button label="Faire le ménage" icon="trash-outline" compact onPress={tidy} disabled={!Telechargeur} />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Compte ListenBrainz (facultatif) : tes écoutes complètes y partent, et sa « Weekly Exploration »
 * calculée pour toi entre dans ta sélection du lundi.
 */
function ListenBrainz() {
  const [user, setUser] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!demoMode) getMeta('lb_user').then(setUser).catch(() => undefined);
  }, []);

  const link = async () => {
    const t = token.trim();
    if (!t) return;
    setBusy(true);
    try {
      const name = await validateToken(t);
      if (!name) return Alert.alert('ListenBrainz', 'Ce jeton n’est pas reconnu. Copie-le depuis ta page de réglages ListenBrainz.');
      await setMeta('lb_token', t);
      await setMeta('lb_user', name);
      await setMeta('lb_sent_id', '0');
      setUser(name);
      setToken('');
      refresh().catch(() => undefined);
    } catch (e) {
      Alert.alert('ListenBrainz', `Impossible de vérifier le jeton : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    const d = await db();
    await d.runAsync("DELETE FROM meta WHERE key IN ('lb_token', 'lb_user', 'lb_sent_id')");
    setUser(null);
  };

  return (
    <>
      <SectionHeader title="ListenBrainz" />
      <View style={styles.group}>
        {user ? <Row icon="person-circle" label="Compte relié" value={user} first /> : null}
        {!user ? (
          <View style={[styles.row, { paddingVertical: 8 }]}>
            <Ionicons name="key" size={18} color={colors.muted} />
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Jeton utilisateur"
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
          </View>
        ) : null}
      </View>
      <Text style={styles.foot}>
        Facultatif. Avec ton compte, JukeBox envoie tes écoutes complètes à ListenBrainz, qui calcule chaque semaine une « Weekly
        Exploration » faite pour toi : elle entre dans ta sélection du lundi. Ton historique d'écoute devient public sur ton profil
        ListenBrainz. Sans compte, les titres similaires viennent quand même de ListenBrainz, de façon anonyme.
      </Text>
      <View style={styles.actions}>
        {user ? (
          <Button label="Délier" icon="unlink" compact onPress={unlink} />
        ) : (
          <>
            <Button label={busy ? 'Vérification…' : 'Relier'} icon="link" compact onPress={link} disabled={busy || !token.trim() || demoMode} />
            <Button label="Mon jeton" icon="open-outline" compact onPress={() => Linking.openURL('https://listenbrainz.org/settings/')} />
          </>
        )}
      </View>
    </>
  );
}

function Row({ icon, label, value, first }: { icon: IconName; label: string; value: string; first?: boolean }) {
  return (
    <View style={[styles.row, !first && styles.sep]}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.stroke, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  sep: { borderTopWidth: 1, borderTopColor: colors.stroke },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  value: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, maxWidth: '55%', textAlign: 'right' },
  foot: { fontFamily: fonts.regular, fontSize: 13, color: colors.dim, lineHeight: 19, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text, paddingVertical: 8 },
});
