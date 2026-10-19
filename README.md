# OnlySongs

A small web app that watches a Spotify account and, when a podcast episode or audiobook is playing, replaces it with a song, playlist, or album you picked. It runs on a server, so the same rule applies to a phone, laptop, car, or speaker.

Spotify Premium is required. Each person brings their own Spotify developer app (Client ID and Client Secret). There is no shared Spotify app. Spotify's Development Mode caps each app at a handful of users, and playback control through the API requires Premium.

The stack, the web and worker processes, and the runtime diagrams are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). How the tests and CI are laid out is in [TESTING.md](TESTING.md).

## What you need

- Node.js 22 or newer, for local development
- Docker, for Postgres, Redis, and Mailpit locally
- A Spotify Premium account
- For a public deploy: a Railway account (or a VM with Docker), a domain, and a Resend account for email

## Run it locally

1. Start Postgres, Redis, and Mailpit (which catches the app's emails):

```bash
docker compose -f docker-compose.dev.yml up -d
```

2. Create the env file and a 32-byte encryption key:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste that hex string into `ENCRYPTION_KEY` in `.env`. Leave `APP_URL` as `http://127.0.0.1:3000`. The example file already points SMTP at Mailpit, so verification and password-reset emails appear at [http://127.0.0.1:8025](http://127.0.0.1:8025).

3. Install dependencies and apply the database migrations:

```bash
npm install
npx prisma migrate deploy
```

4. Start the site and the worker in two terminals:

```bash
npm run dev
npm run worker
```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Use `127.0.0.1`, not `localhost`. Spotify matches the redirect URI exactly, and the setup screen shows the URI to paste.

6. In the [Spotify dashboard](https://developer.spotify.com/dashboard), create an app, select Web API, and paste the redirect URI. Save the Client ID and Client Secret in this app, then connect your account. The dashboard opens in a new tab when you create an account here.

7. Pick a replacement, turn the blocker on, and play a podcast. **Check now** runs one check immediately. The worker does the rest. The dashboard warns you if the worker is not running.

Set `ADMIN_EMAIL` in `.env` before that person signs up if you want the operator page.

If Docker Desktop stops, every page fails until Postgres and Redis are back. Run step 1 again; the app reconnects on its own.

## Configuration

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Local only | Postgres URL. Railway and production Compose set this themselves. Without `connection_limit` in the URL, the worker uses a pool of 20 connections and web 10. |
| `REDIS_URL` | Local only | Redis URL. Railway and production Compose set this themselves. |
| `APP_URL` | Yes | Public origin, no trailing slash. Local: `http://127.0.0.1:3000`. Production: `https://your.domain`. |
| `ENCRYPTION_KEY` | Yes | 32 bytes as 64 hex characters. The root key: HKDF derives separate keys from it for Spotify secrets at rest and for session cookies. |
| `ENCRYPTION_KEY_PREVIOUS` | Rotation only | The old root key while rotating. Values under it still decrypt; `npm run reencrypt -- --apply` rewrites them under the new key. Rotating also signs everyone out. |
| `SESSION_SECRET` | No | At least 32 characters. Signs session cookies instead of the key derived from `ENCRYPTION_KEY`. |
| `ADMIN_EMAIL` | No | This address becomes the operator on sign-up or login, and can always sign up. |
| `SIGNUPS` | No | `invite` (default): sign-up only through an approved early-access invite. `open`: anyone can create an account. |
| `APP_DOMAIN` | Self-hosted only | Hostname only, such as `onlysongs.io`. Caddy requests a certificate for it. |
| `RESEND_API_KEY` | Production (or SMTP) | Sends email through [Resend](https://resend.com)'s HTTPS API, which works on Railway's Hobby plan where outbound SMTP is blocked. Takes priority over SMTP when set. |
| `MAIL_FROM` | With Resend | Sender, such as `OnlySongs <hello@your.domain>`. Its domain must be verified in Resend (SPF and DKIM records). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Local, or instead of Resend | SMTP. Locally, point it at Mailpit (`127.0.0.1`, port `1025`) and read mail at `http://127.0.0.1:8025`. |

Email covers verification, password reset, and Spotify notices. Web and worker refuse to start on an `https://` `APP_URL` with neither `RESEND_API_KEY` nor `SMTP_HOST`. With neither set locally, each email is written to the log.

The redirect URI is always `${APP_URL}/callback/spotify`. The container also reads `PROCESS` (`web` or `worker`) and `RUN_MIGRATIONS=1` (Compose only). The load test's `SPOTIFY_FAKE_URL` and `ONLYSONGS_LOAD_TEST` are described in [TESTING.md](TESTING.md).

## Early access

Sign-up is invite-only by default (`SIGNUPS=invite`). Visitors leave an email on the landing page. On the Admin page the operator approves or declines each request. Approving emails a single-use link, valid for 14 days, to `/join`, where the person sets a password; the account starts with its email confirmed. Resend issues a fresh link and voids the old one. The `ADMIN_EMAIL` address can always sign up directly.

## Admin

The `ADMIN_EMAIL` account sees an Admin page with three totals (accounts, active today, waiting for approval), an accounts-over-time chart and a daily-active-users chart over 7, 30 or 90 UTC days, the early-access requests, and the users table. A user counts as active once per day when they sign in or use the site; background checks don't count.

## What a check does

Every interval (10–300 seconds, default 60):

- Refresh the access token if it expires within 60 seconds.
- Read `GET /v1/me/player?additional_types=track,episode`.
- Do nothing when playback is stopped, paused, or is a normal track.
- Replace a podcast when podcast blocking is on, and an audiobook when audiobook blocking is on. Each switch is independent. Both start on.
- If the device returns 403 or 404, try skip-next, then log the result.
- Wait 15 seconds before considering that user again, so one episode is not swapped twice.
- On `invalid_grant` with the newest refresh token, turn the blocker off and queue a reconnect email.
- On HTTP 429, wait for `Retry-After`. A `QUOTA_EXCEEDED` body pauses that user for an hour. Other users keep their own jobs.

Quiet hours skip the Spotify call. One allow list leaves a show or an audiobook playing.

Spotify does not push playback changes, so some of a podcast always plays before the swap. At 60 seconds that is about 30 seconds on average.

## Tests

```bash
npm test
npm run test:integration
```

`npm test` needs no database. `npm run test:integration` needs the local Postgres and Redis from `docker compose -f docker-compose.dev.yml up -d`. `npm run load-test -- --users 1000 --minutes 10` runs the real worker against a fake Spotify. What each suite covers, how CI is split, and where to add a test are in [TESTING.md](TESTING.md).

Work happens on feature branches off `dev`, merged by pull request into `dev`. `dev` merges into `main` for a release, and `main` is what gets deployed.

## Deploy

Production is set up for Railway, but nothing is deployed yet. A self-hosted VM with Docker Compose also works and is described after it.

### Railway

`.railway/railway.ts` defines the project: Postgres, Redis, and the `web` and `worker` services, both built from this repo's `Dockerfile` on `main`. Railway terminates HTTPS, and the services reach Postgres and Redis over Railway's private network. Each deploy runs `prisma migrate deploy` once as a pre-deploy command. Web is health-checked on `/api/health`. The worker runs 2 replicas.

```bash
brew install railway
railway login
railway link                      # or create the project the first time
railway config plan               # preview changes from .railway/railway.ts
railway config apply              # apply them
```

Secrets are not in the config file. Set them once on the `web` service; the worker reads them from web:

```bash
railway variable set ENCRYPTION_KEY=<64 hex chars> --service web
railway variable set APP_URL=https://<your domain> --service web
railway variable set ADMIN_EMAIL=you@example.com --service web
railway variable set RESEND_API_KEY=<key from Resend> MAIL_FROM="OnlySongs <hello@your.domain>" --service web
```

Mail is required: with an `https://` `APP_URL`, web and worker refuse to start without it. Railway's Hobby plan blocks outbound SMTP, so production uses Resend's HTTPS API. Verify the sending domain in Resend first.

Generate the encryption key fresh for production and never change it, or stored Spotify secrets will not decrypt. Each user's Spotify app needs the redirect URI `https://<your domain>/callback/spotify`.

| Check | URL | Use |
| --- | --- | --- |
| Web | `/api/health` | Railway's deploy health check |
| Worker | `/api/health/worker` | Uptime monitor; 503 when no worker heartbeat in 35 seconds |

Turn on daily and weekly backups for the Postgres volume in the Railway dashboard (service → Backups). Logs: `railway logs --service worker`.

### Self-hosted VM

The self-hosted stack is Caddy, the web app, the worker, Postgres, and Redis. Caddy obtains a Let's Encrypt certificate and proxies HTTPS to the app. Postgres and Redis are not published on the host.

Use a small Linux VM with Docker and Docker Compose. Open TCP 80 and 443. Point an A (or AAAA) record for your hostname at the server, for example `onlysongs.io`.

```bash
git clone https://github.com/Mithridates01/onlysongs.io.git
cd onlysongs.io
cp .env.example .env
```

Edit `.env` on the server:

```bash
APP_DOMAIN=onlysongs.io
APP_URL=https://onlysongs.io
ENCRYPTION_KEY=paste-a-new-64-hex-char-key
ADMIN_EMAIL=you@example.com
RESEND_API_KEY=...
MAIL_FROM=OnlySongs <hello@onlysongs.io>
```

`APP_DOMAIN` is the hostname only. `APP_URL` is `https://` plus that hostname. Generate a new `ENCRYPTION_KEY` on the server. Do not reuse a laptop key if the laptop `.env` was ever copied around, and do not change the key later or stored Spotify secrets will not decrypt.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up -d --build
```

The first start migrates the database, then serves the site. Watch the logs until Caddy has a certificate:

```bash
docker compose logs -f caddy web worker
```

In the Spotify dashboard, set the redirect URI to `https://onlysongs.io/callback/spotify`, select Web API, then connect from the site.

Updates:

```bash
git pull
docker compose up -d --build
```

Logs and health:

```bash
docker compose logs -f worker
curl -fsS https://onlysongs.io/api/health
```

Backup: the database volume is named `pgdata`. A logical backup is enough for this app:

```bash
docker compose exec postgres pg_dump -U blocker blocker > blocker.sql
```

Keep that file somewhere other than the server. Restoring is `psql` into an empty database, then `docker compose up -d`.

### Security notes

- Client secrets and tokens are encrypted with AES-256-GCM under a key derived from `ENCRYPTION_KEY`. API responses show only the last four characters of the Client ID.
- Each sign-in is a row in `sessions`, so logging out, "Sign out other devices", the operator's "End sessions", and a password reset all end sessions on the server.
- Verification and reset links are single use, expire (24 hours and 1 hour), and are stored only as SHA-256 hashes.
- Sign-in, signup, password reset, and credential changes are rate limited in Redis per account and per IP. The IP comes from the first `X-Forwarded-For` entry, so the proxy in front must set that header.
- Responses carry a CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, and HSTS. Connecting Spotify is a POST.
- The production database password in `docker-compose.yml` is for the private Docker network. Do not publish port 5432.
- Keep `.env` on the server only. It is listed in `.gitignore`.
- Development Mode is for personal, non-commercial use. Charging for this would need Spotify's extended quota approval.

## Layout

- `src/app` — pages and HTTP routes
- `src/lib` — the check (`check-plan.ts` decides, `blocker-run.ts` does the I/O), Spotify client and tokens (`spotify.ts`, `spotify-auth.ts`, `accounts.ts`), accounts and sessions, encryption, Redis and the queue, request schemas
- `src/worker` — scheduled playback checks and queued emails
- `prisma` — schema and migrations
- `tests` — unit tests and the Postgres/Redis integration suite. See `TESTING.md`.
- `scripts` — the load test (`scripts/load/`), the Docker smoke test, and the re-encrypt script
- `.railway/railway.ts` — the Railway project as code
- `docs/ARCHITECTURE.md` — stack, runtime, and data model
- `docker-compose.yml` — self-hosted production stack
- `docker-compose.dev.yml` — local Postgres, Redis, and Mailpit
