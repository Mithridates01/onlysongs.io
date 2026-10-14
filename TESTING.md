# Testing

OnlySongs has three automated layers. Unit tests cover pure rules. Integration tests run the playback check and the account routes against Postgres and Redis with Spotify HTTP stubbed. A smoke script boots the Docker image and checks health, signup, login, and the worker heartbeat.

A real Spotify login and a live podcast-to-song swap stay manual. Automated runs stub Spotify HTTP and use a throwaway encryption key.

## Run

Start Postgres and Redis first if you are running the integration suite:

```bash
docker compose -f docker-compose.dev.yml up -d
```

| Command | What it runs | Services |
| --- | --- | --- |
| `npm test` | Unit tests | None |
| `npm run test:integration` | Integration tests | Local Postgres 16 and Redis 7 |
| `npm run typecheck` | `next typegen` and `tsc --noEmit` | None |
| `bash scripts/smoke.sh` | Health, signup, login, signed-out status, worker heartbeat | The stack in `docker-compose.ci.yml` |

`npm test` includes `tests/*.test.ts`. `npm run test:integration` includes `tests/integration/**/*.test.ts` via `vitest.integration.config.ts`. The two commands stay separate so the unit job can run with no database.

## Layout

| Path | Role |
| --- | --- |
| `tests/blocker-logic.test.ts` | Playback classification, play commands, token refresh |
| `tests/spotify-http.test.ts` | Retry-After, quota body, token HTTP fixtures |
| `tests/quiet-hours.test.ts` | Quiet-hour windows and zoned midnight |
| `tests/spotify-uri.test.ts` | `spotify:` URIs and `open.spotify.com` links |
| `tests/crypto.test.ts` | AES-256-GCM round trip and a wrong key |
| `tests/integration/blocker-run.test.ts` | `runUserCheck` against Postgres, Redis, and stubbed Spotify |
| `tests/integration/api.test.ts` | Signup, login, status, and enabling the blocker |
| `tests/integration/global-setup.ts` | Creates `onlysongs_test` and applies migrations |
| `scripts/smoke.sh` | Curl checks against a running image |
| `.github/workflows/ci.yml` | Pull-request and `main` pipeline |

## Unit tests

These import the library functions and pass fixtures in memory. They open no sockets.

`tests/blocker-logic.test.ts` checks the rules a future change is most likely to break:

- A track, a paused player, HTTP 204, and a null item that is not an episode stay idle or music.
- A podcast episode is blocked from `currently_playing_type`, from `item.type`, or from a `spotify:episode:` URI, and left alone when podcast blocking is off.
- An audiobook is recognized from a chapter type, an audiobook URI, an `audiobook` parent, or an audiobook playback context, including when Spotify labels the chapter as an episode. It is blocked only when audiobook blocking is on.
- One allow list matches the show id or the audiobook id.
- A track sends `{ uris }`. A playlist or album sends `{ context_uri }`.
- Play outcomes: 204 succeeds, 403 and 404 fall back to skip-next.
- Retry-After is honored. `QUOTA_EXCEEDED` pauses for one hour.
- An access token expiring within 60 seconds is refreshed. A fresh token is kept.
- `invalid_grant` marks the connection broken. A 401 is retried once. A second 401 gives up. A transient refresh error stays unbroken.

The other unit files cover URI parsing, quiet hours (same-day end is exclusive, overnight wrap, equal bounds mean off), encryption, and the Spotify HTTP helpers.

## Integration tests

These use the dev Postgres and Redis from `docker-compose.dev.yml`. Global setup creates the database `onlysongs_test` if it is missing, then runs `prisma migrate deploy`. Redis traffic goes to database 1 (`redis://127.0.0.1:6379/1`). The dev database `blocker` and the worker heartbeat on Redis database 0 are left alone. The suite refuses any other database name or Redis index.

Spotify is stubbed by replacing `globalThis.fetch` for the length of each test. Token refresh and the player calls both go through that fetch. The throwaway encryption key lives in `tests/integration/env.ts`. Mail is off because `SMTP_HOST` is cleared, so quota and breakage notices are log lines.

`runUserCheck` cases:

- A playing track is left alone, nothing is written to the activity log, and an earlier failure count is cleared.
- A playing episode is replaced with the saved track on the same device. The activity row is `swap` / `replaced`, and the cooldown is about 15 seconds.
- A podcast is left playing when podcast blocking is off. An audiobook chapter that arrives as an episode is still replaced when audiobook blocking is on.
- An allow-listed show is left playing and logged as `skip` / `allow_listed`.
- Quiet hours return `quiet_hours` and make no Spotify call. The failure count stays as it was.
- A 401 refreshes once. The retry uses the new access token, and the stored refresh token is unchanged. A second 401 marks the connection broken and turns the blocker off. `invalid_grant` does the same and never reads the player.
- Play responses 403 and 404 fall back to `POST /me/player/next`. A restricted device does not increment the failure count. A 500 after a successful player read does.
- `QUOTA_EXCEEDED` sets that user's pause to about one hour, sets the connection to `quota_paused`, and logs `quota`.
- Two overlapping checks for one user: the second returns `busy` while the Redis lock `lock:check:<userId>` is held.

Route cases in `tests/integration/api.test.ts`:

- Signup and login set an HttpOnly, `SameSite=Lax` `pb_session` cookie. The signed-in status payload reports the blocker off.
- Signed-out `/api/status` returns 401 from middleware and from the route.
- Enabling the blocker is rejected with no replacement, and rejected again until Spotify is connected. With both saved, the setting turns on and a BullMQ scheduler `blocker-<userId>` appears. Turning it off removes that scheduler.

Route handlers read the session from `next/headers`. The test supplies that cookie through a mock because the handlers are called directly, without a Next.js server.

## Smoke

`docker-compose.ci.yml` builds the production image and starts web, worker, Postgres, and Redis on a private network. The web process is published on `127.0.0.1:3000`. `scripts/smoke.sh` then:

1. Waits for `GET /api/health` to return `{ "ok": true }`.
2. Signs up and checks that the response sets `pb_session`.
3. Logs in with the same password and checks the cookie again.
4. Expects signed-out `GET /api/status` to return 401.
5. Waits until Redis has `worker:heartbeat`.

The script does not log into Spotify. On a laptop where `npm run dev` already owns port 3000, leave this stack to CI.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pull requests and on pushes to `main`.

| Job | When | Steps |
| --- | --- | --- |
| Unit and typecheck | Every pull request and push to `main` | `npm ci`, `npm run typecheck`, `npm test` |
| Integration | Every pull request and push to `main` | Postgres 16 and Redis 7 service containers, then `npm run test:integration` |
| Image smoke | Push to `main` | `docker compose -f docker-compose.ci.yml up -d --build --wait`, then `scripts/smoke.sh` |

The image job generates a one-run encryption key in the workflow and tears the stack down afterward. A pull request does not build the image.

## Adding a test

Put a pure rule in `tests/<topic>.test.ts` so `npm test` keeps running without services. Put a check that needs rows, the Redis lock, or an HTTP route in `tests/integration/`. Integration files run one at a time. Clean up users you create. The setup file already deletes users in `onlysongs_test` and flushes Redis database 1 before each file.

Stub Spotify with `stubFetch` in `tests/integration/helpers.ts`. Assert the URL, method, and body of the player call when the test is about a swap. Assert that `fetch` was not called when the test is about a skip (quiet hours, or a return before the player read).

`npm run typecheck` includes `tests/**/*.ts`. A new test file is part of that check.
