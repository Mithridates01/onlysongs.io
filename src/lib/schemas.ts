// Request body schemas, shared by routes and their tests. Each schema's error
// messages are the ones users see.
import { z } from "zod";
import { normalizeClock } from "./quiet-hours";
import { parseSpotifyUri } from "./spotify-uri";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const quietHours = z
  .object({ start: z.string(), end: z.string() })
  .transform((value, ctx) => {
    const start = normalizeClock(value.start);
    const end = normalizeClock(value.end);
    if (!start || !end) {
      ctx.addIssue({ code: "custom", message: "Quiet hours use 24-hour times like 06:00." });
      return z.NEVER;
    }
    if (start === end) {
      ctx.addIssue({ code: "custom", message: "Quiet hours need a start and end that differ." });
      return z.NEVER;
    }
    return { start, end };
  });

const allowedShow = z.object({
  id: z.string().regex(/^[A-Za-z0-9]+$/, "A show on the allow list looks invalid."),
  name: z.string().trim().min(1, "A show on the allow list is incomplete.").max(200, "A show on the allow list looks invalid."),
});

const replacement = z
  .object({
    uri: z.string(),
    label: z.string().trim().min(1, "The replacement needs a name.").max(300, "The replacement needs a name."),
    art: z.string().nullish(),
    kind: z.enum(["track", "playlist", "album"], "The replacement must be a track, playlist, or album."),
  })
  .transform((value, ctx) => {
    const parsed = parseSpotifyUri(value.uri);
    if (!parsed || (parsed.kind !== "track" && parsed.kind !== "playlist" && parsed.kind !== "album")) {
      ctx.addIssue({ code: "custom", message: "The replacement must be a track, playlist, or album." });
      return z.NEVER;
    }
    if (parsed.kind !== value.kind) {
      ctx.addIssue({ code: "custom", message: "The replacement type does not match its Spotify link." });
      return z.NEVER;
    }
    return { uri: parsed.uri, label: value.label, art: value.art || null, kind: parsed.kind };
  });

export const settingsPatch = z
  .object({
    enabled: z.boolean("enabled must be true or false."),
    intervalSeconds: z
      .number("Poll interval must be between 10 and 300 seconds.")
      .int("Poll interval must be between 10 and 300 seconds.")
      .min(10, "Poll interval must be between 10 and 300 seconds.")
      .max(300, "Poll interval must be between 10 and 300 seconds."),
    blockPodcasts: z.boolean("blockPodcasts must be true or false."),
    blockAudiobooks: z.boolean("blockAudiobooks must be true or false."),
    timeZone: z.string().refine(isTimeZone, "That time zone is not recognized."),
    quietHours: quietHours.nullable(),
    allowedShows: z
      .array(allowedShow, "allowedShows must be a list.")
      .max(40, "The allow list can hold up to 40 shows and audiobooks.")
      .transform((shows) => shows.filter((show, index) => shows.findIndex((other) => other.id === show.id) === index)),
    replacement: replacement.nullable(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatch>;

export const spotifyCredentials = z.object({
  clientId: z.string().trim().min(8).max(80),
  clientSecret: z.string().trim().min(8).max(200),
});

const email = z.string().trim().toLowerCase().max(200).pipe(z.email());
const newPassword = z.string("Use a password of at least 8 characters.").min(8, "Use a password of at least 8 characters.").max(200);

export const signupBody = z.object({ email, password: newPassword });
export const loginBody = z.object({ email, password: z.string().min(8).max(200) });
export const forgotBody = z.object({ email });
export const resetBody = z.object({ token: z.string().min(20).max(100), password: newPassword });
export const tokenBody = z.object({ token: z.string().min(20).max(100) });
export const earlyAccessBody = z.object({ email });
export const joinBody = z.object({ token: z.string().min(20).max(100), password: newPassword });
export const adminDecisionBody = z.object({ action: z.enum(["approve", "decline"]) });
