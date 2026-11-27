import { requireOptionalNativeModule } from 'expo';

export type LibraryTrack = {
  uri: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number;
  path: string | null;
  addedAt: number;
};

export type Playlist = { name: string; tracks: { title: string | null; artist: string | null }[] };

export type NowPlaying = { title: string; artist: string; album: string; playing: boolean; playedMs: number };

type EcouteNative = {
  hasAccess(): boolean;
  openAccessSettings(): void;
  batteryUnrestricted(): boolean;
  openBatterySettings(): void;
  holdFocus(on: boolean): void;
  drain(): string;
  nowPlaying(): NowPlaying | null;
  trackedPackages(): string[];
  setTrackedPackages(packages: string[]): void;
  library(): Promise<LibraryTrack[]>;
  playlists(): Promise<Playlist[]>;
};

// Absent sur le web et dans Expo Go : l'appli fonctionne alors en mode démo.
const Ecoute = requireOptionalNativeModule<EcouteNative>('Ecoute');
export default Ecoute;
