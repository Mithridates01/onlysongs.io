import type { ConnectionStatus } from "@prisma/client";

// The steps from sign-up to a working blocker, in order. The admin funnel
// counts how many accounts reached each one.
export const SETUP_STEPS = [
  "Signed up",
  "Saved Spotify keys",
  "Connected Spotify",
  "Picked a song",
  "Turned the blocker on",
  "First podcast swapped",
] as const;

export type StageInput = {
  spotify: { status: ConnectionStatus; hasRefreshToken: boolean } | null;
  hasSong: boolean;
  enabled: boolean;
  swaps: number;
};

export type Stage = {
  // Index into SETUP_STEPS of the furthest step reached.
  reached: number;
  label: string;
  tone: "good" | "warn" | "bad";
};

export function setupStage(input: StageInput): Stage {
  const { spotify } = input;
  // A lost connection was connected once; broken connections keep their keys.
  const connected = Boolean(spotify && (spotify.hasRefreshToken || spotify.status === "broken"));
  const steps = [true, Boolean(spotify), connected, input.hasSong, input.enabled];
  // Someone who has had a swap went through every step, even if they've since
  // turned the blocker off or changed songs.
  const reached = input.swaps > 0 ? SETUP_STEPS.length - 1 : steps.indexOf(false) === -1 ? steps.length - 1 : steps.indexOf(false) - 1;

  if (spotify?.status === "broken") return { reached, label: "Spotify access lost", tone: "bad" };
  if (spotify?.status === "disconnected" && !spotify.hasRefreshToken) {
    return { reached, label: "Disconnected Spotify", tone: "warn" };
  }
  if (input.swaps > 0) {
    return input.enabled ? { reached, label: "Working", tone: "good" } : { reached, label: "Turned the blocker off", tone: "warn" };
  }
  const labels: Stage[] = [
    { reached, label: "Hasn’t added Spotify keys", tone: "warn" },
    { reached, label: "Stuck at Spotify sign-in", tone: "warn" },
    { reached, label: "Needs a song", tone: "warn" },
    { reached, label: "Blocker off", tone: "warn" },
    { reached, label: "On, no swaps yet", tone: "good" },
  ];
  return labels[reached];
}

// How many accounts reached each step, first step first.
export function funnel(stages: Stage[]): { step: string; count: number }[] {
  return SETUP_STEPS.map((step, i) => ({ step, count: stages.filter((stage) => stage.reached >= i).length }));
}
