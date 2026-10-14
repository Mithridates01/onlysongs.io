# Podcast Blocker

A small web app that watches a Spotify account and, when a podcast episode is playing, replaces it with a song, playlist, or album you picked. It runs on a server, so the same rule applies to a phone, laptop, car, or speaker.

Spotify Premium is required. Each person brings their own Spotify developer app (Client ID and Client Secret). There is no shared Spotify app. Spotify's Development Mode caps each app at a handful of users, and playback control through the API requires Premium.

## What you need

- Node.js 22 or newer, for local development
- Docker, for Postgres and Redis locally and for the full production stack
- A domain name pointing at the server, for the HTTPS deploy
- A Spotify Premium account

## Run it locally

1. Start Postgres and Redis:

```bash
docker compose -f docker-compose.dev.yml up -d
```

2. Create the env file and a 32-byte encryption key:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste that hex string into `ENCRYPTION_KEY` in `.env`. Leave `APP_URL` as `http://127.0.0.1:3000`.

3. Install dependencies and apply the database migration:

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

## Configuration

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Local only | Postgres URL. Production Compose sets this itself. |
| `REDIS_URL` | Local only | Redis URL. Production Compose sets this itself. |
| `APP_URL` | Yes | Public origin, no trailing slash. Local: `http://127.0.0.1:3000`. Production: `https://your.domain`. |
| `ENCRYPTION_KEY` | Yes | 32 bytes as 64 hex characters. Encrypts Spotify secrets at rest. |
| `ADMIN_EMAIL` | No | This address becomes the operator on sign-up or login. |
| `APP_DOMAIN` | Production | Hostname only, such as `blocker.example.com`. Caddy requests a certificate for it. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Mail when Spotify disconnects or the quota is exceeded. Without these, the notice is written to the log. |

The redirect URI is always `${APP_URL}/callback/spotify`.

## What a check does

Every interval (10–300 seconds, default 60):

- Refresh the access token if it expires within 60 seconds.
- Read `GET /v1/me/player?additional_types=track,episode`.
- Do nothing when playback is stopped, paused, or is a normal track.
- Replace an episode on the same device. Audiobook chapters are included unless you turn that off.
- If the device returns 403 or 404, try skip-next, then log the result.
- Wait 15 seconds before considering that user again, so one episode is not swapped twice.
- On `invalid_grant`, turn the blocker off and ask for a reconnect.
- On HTTP 429, wait for `Retry-After`. A `QUOTA_EXCEEDED` body pauses that user for an hour. Other users keep their own jobs.

Quiet hours skip the Spotify call. Allow-listed shows are left playing.

Spotify does not push playback changes, so some of a podcast always plays before the swap. At 60 seconds that is about 30 seconds on average.

## Tests

```bash
npm test
```

The unit tests cover track, episode, chapter, a null item, 204, paused playback, 403, 404, 429, and the token refresh path. They do not call Spotify.

## Deploy

The production stack is Caddy, the web app, the worker, Postgres, and Redis. Caddy obtains a Let's Encrypt certificate and proxies HTTPS to the app. Postgres and Redis are not published on the host.

### Server

Use a small Linux VM with Docker and Docker Compose. Open TCP 80 and 443. Point an A (or AAAA) record for your hostname at the server, for example `blocker.example.com`.

```bash
git clone https://github.com/Mithridates01/podcast-blocker.git
cd podcast-blocker
cp .env.example .env
```

Edit `.env` on the server:

```bash
APP_DOMAIN=blocker.example.com
APP_URL=https://blocker.example.com
ENCRYPTION_KEY=paste-a-new-64-hex-char-key
ADMIN_EMAIL=you@example.com
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

In the Spotify dashboard, set the redirect URI to `https://blocker.example.com/callback/spotify`, select Web API, then connect from the site.

### Updates

```bash
git pull
docker compose up -d --build
```

### Logs and health

```bash
docker compose logs -f worker
curl -fsS https://blocker.example.com/api/health
```

### Backup

The database volume is named `pgdata`. A logical backup is enough for this app:

```bash
docker compose exec postgres pg_dump -U blocker blocker > blocker.sql
```

Keep that file somewhere other than the server. Restoring is `psql` into an empty database, then `docker compose up -d`.

### Security notes

- Client secrets and tokens are encrypted with AES-256-GCM. API responses show only the last four characters of the Client ID.
- The production database password in `docker-compose.yml` is for the private Docker network. Do not publish port 5432.
- Keep `.env` on the server only. It is listed in `.gitignore`.
- Development Mode is for personal, non-commercial use. Charging for this would need Spotify's extended quota approval.

## Layout

- `src/app` — pages and HTTP routes
- `src/lib` — Spotify client, blocker rules, encryption, sessions
- `src/worker` — scheduled playback checks
- `prisma` — schema and migrations
- `docker-compose.yml` — production stack
- `docker-compose.dev.yml` — local Postgres and Redis only
