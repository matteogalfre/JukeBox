import { requireOptionalNativeModule } from 'expo';

export type DownloadJob = {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  trackNumber: number;
  durationS: number;
  coverUrl: string;
};

export type DownloadStatus = { id: string; state: string; attempts: number; step: string | null; stopReason: number };

type TelechargeurNative = {
  enqueue(jobJson: string, wifiOnly: boolean): void;
  pendingCount(): Promise<number>;
  status(): Promise<DownloadStatus[]>;
  networkIsUnmetered(): boolean;
  drainResults(): string;
  deleteMedia(uri: string): Promise<boolean>;
  moveMedia(uri: string, relativePath: string): Promise<boolean>;
  updateEngine(): Promise<{ status: string; version: string | null }>;
  engineVersion(): Promise<string | null>;
};

const Telechargeur = requireOptionalNativeModule<TelechargeurNative>('Telechargeur');
export default Telechargeur;
