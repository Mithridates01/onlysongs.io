export type ConnectionState = "disconnected" | "needs_connect" | "connected" | "broken" | "quota_paused";

export type ReplacementView = {
  uri: string;
  label: string;
  art: string | null;
  kind: "track" | "playlist" | "album";
};

export type AllowedShowView = { id: string; name: string };

export type QuietHoursView = { start: string; end: string } | null;

export type StatusResponse = {
  blockerEnabled: boolean;
  intervalSeconds: number;
  blockPodcasts: boolean;
  blockAudiobooks: boolean;
  timeZone: string;
  quietHours: QuietHoursView;
  quietHoursActive: boolean;
  allowedShows: AllowedShowView[];
  connection: ConnectionState;
  spotifyUserId: string | null;
  clientIdLast4: string | null;
  lastCheckedAt: string | null;
  pausedUntil: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  nowPlaying: {
    kind: string;
    title: string | null;
    subtitle: string | null;
    art: string | null;
    blocked: boolean;
  };
  blockedToday: number;
  blockedAllTime: number;
  replacement: ReplacementView | null;
  worker: { online: boolean; heartbeatAt: string | null };
  warnings: string[];
  redirectUri: string;
  email: string;
  isAdmin: boolean;
};

export type SearchHitView = {
  id: string;
  uri: string;
  kind: "track" | "playlist" | "album" | "show" | "episode";
  title: string;
  subtitle: string;
  art: string | null;
};

export type ActivityRow = {
  id: string;
  at: string;
  showName: string | null;
  episodeName: string | null;
  deviceName: string | null;
  action: string;
  result: string;
  httpStatus: number | null;
};
