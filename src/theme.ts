// Noir neutre (sans teinte bleue) et un seul accent franc, vert acide : l'appli se lit d'un coup
// d'œil, le vert ne sert qu'à ce qui compte (garder, onglet actif, progression).
export const colors = {
  bg: '#0A0A0A',
  bgRaised: '#101010',
  surface: '#151515',
  surface2: '#1D1D1D',
  surface3: '#282828',
  stroke: 'rgba(255,255,255,0.07)',
  strokeStrong: 'rgba(255,255,255,0.13)',
  text: '#FAFAFA',
  muted: '#A3A3A3',
  dim: '#666666',
  accent: '#CCFF4D',
  accentSoft: 'rgba(204,255,77,0.13)',
  sky: '#8AB4FF',
  skySoft: 'rgba(138,180,255,0.13)',
  coral: '#FF5C5C',
  coralSoft: 'rgba(255,92,92,0.14)',
  gold: '#FFC94D',
  goldSoft: 'rgba(255,201,77,0.14)',
  onAccent: '#0A0A0A',
  // Voiles sur les pochettes (pastilles, bouton lecture) et barre d'onglets.
  scrim: 'rgba(10,10,10,0.62)',
  scrimStrong: 'rgba(10,10,10,0.8)',
  bar: 'rgba(21,21,21,0.97)',
};

export const gradients = {
  // Presque uni : un léger relief, pas un arc-en-ciel.
  accent: ['#D8FF6B', '#BDF53A'] as const,
  scrimBottom: ['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.96)'] as const,
};

export const fonts = {
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };
export const space = { page: 20 };

// Hauteur réservée en bas d'écran pour la barre d'onglets flottante.
export const TAB_BAR_SPACE = 110;
