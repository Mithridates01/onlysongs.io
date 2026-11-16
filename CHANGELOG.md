# Changelog

Changes waiting to be released, newest first. Move a section under a version heading when `dev` is released to `main`.

## Unreleased

### Allowed hours and unlock delay (branch `unlock-delay`)

- Allowed hours (formerly quiet hours) moved to the dashboard: a 24-hour bar shows the window, now, and any change waiting.
- While the blocker is on, turning it off and widening allowed hours wait one hour; "Keep it on" or "Cancel" undoes them. Narrowing applies at once.
- Waiting changes apply on the next check, status load or save (`settlePending`), with no timer.

### Listening history (branch `listening-history`)

- **History from checks already being made.** When the worker reads someone's player, a row is saved only if what's playing changed. A song across many checks is one row, and X → Y → X is three. Stopping or pausing counts as a change. No extra Spotify calls.
- **What's kept:**
  - type (song, podcast, audiobook, ad), title, artists, album or show, and length
  - position when first seen
  - where it was played from (playlist, album, artist page, liked songs) and its link
  - device name, type and volume
  - shuffle and repeat, and the listener's time zone
- **Admin → Listening tab, operators only.** Last-30-day summary:
  - music, podcast and audiobook mix
  - plays by hour in each listener's local time
  - shuffle use
  - top artists, songs and shows, where people play from, and devices
  - a per-account table with each person's last 200 changes
- **Switches and purge.** A platform switch, off until you turn it on, reaches the worker within 30 seconds. A per-account switch is on by default and is never shown to users. Purge works for one account, or for everyone after typing `PURGE ALL`.
- **Retention.** Rows older than 365 days are deleted by the daily prune. Deleting an account deletes its history.
- Migration `listening_history` adds `listening_events`, `app_settings` and `users.history_enabled`.

### Admin metrics and signup emails (branch `admin-metrics`)

- **Setup funnel.** How many accounts reached each step: Spotify keys → Spotify sign-in → song → blocker on → first swap. It shows where people get stuck.
- **Service health.** Blockers on, blockers that are on but not being checked, failing checks, lost Spotify access, Spotify pauses, errors and rate limits in the last 24 hours, and emails sent and failed in the last 7 days (daily tallies in Redis).
- **Swaps chart, coming back, most swapped.** A podcasts-swapped-per-day chart that follows the 7/30/90-day range. Also weekly and monthly active users, how many accounts came back a week after signing up, and the most swapped shows across everyone.
- **Users table.** New columns: setup stage (e.g. "Stuck at Spotify sign-in"), signed-up date and last seen. Accounts with an unconfirmed email are marked.
- **Early access.** Longest wait, typical time to approve, invites that turned into accounts and invites that expired unused. Each waiting request shows how long it has waited.
- **Signup emails.** A new early-access request gets an "on the list" email, and the operator (`ADMIN_EMAIL`) gets a notice with a link to approve. A new account gets a welcome email with the next step, and the operator is told. These sends don't hold up the response, and a failure is only logged.

### Support tools (branch `support-tools`)

- **Account page for the operator.** Admin → click an email. It shows the account's setup and recent checks, and a "What's going on" list that explains what's stopping it in plain language.
- **Logs name the account.** Setup steps and failures are logged with the internal user id (never the email), including why a Spotify sign-in failed.
- **Sentry error tracking** for the web server and worker (`SENTRY_DSN`). Errors only, no performance tracing, and no cookies, headers or request bodies. Handled errors logged with `log.error` are sent too.
- **Read-only support login.** `scripts/support-readonly.sql` creates `support_ro`, which can read secret-free views only.

### Settings save on their own; the dashboard says why the switch is off (branch `settings-autosave`)

- **Settings autosave.** Polling, blocking, time zone, quiet hours and the allow list now save about half a second after each change, with a "Saving… / All changes saved." line. The Save button is gone. Before, these only saved from a button at the bottom, so leaving the page dropped changes without a word. Leaving mid-edit still sends the change.
- **Why the switch is greyed out.** When the blocker can't be turned on, the dashboard says why under the switch: no Spotify app yet, Spotify sign-in didn't finish (with the redirect URI to add), Spotify revoked access, or no replacement song.

### Poll every 5 seconds by default (branch `poll-5s`)

- New accounts check every 5 seconds instead of 60, so a podcast plays for about 3 seconds on average before the swap. The allowed range is now 5–300 seconds (was 10–300). Existing accounts keep their setting.
- The 15-second cooldown after a swap and the per-user check lock are unchanged, so faster polling can't cause double swaps or overlapping checks.
- Migration `poll_default_5s` changes only the column default.

### Audit fixes (branch `audit-fixes`)

- **Next.js 15.5.29.** Fixes a critical advisory (remote code execution in the image optimizer with SVGs, GHSA-2464-fhr4-w9xw) and a denial-of-service advisory (GHSA-p3m5-59mp-jv5r). nodemailer 10.5.0 fixes two SMTP header-injection advisories.
- **The operator needs a verified email.** Admin rights now need the `ADMIN_EMAIL` flag and a confirmed inbox, on the Admin page, its routes and the nav link. Before, signing up first with that address was enough.
- **Stricter CSP.** Scripts run only with a per-request nonce; `'unsafe-inline'` is gone from `script-src`. Middleware sets the policy, and every page renders per request.
- **Samples without Spotify's script.** Spotify's iFrame API ships as an eval-based development build, which a CSP without `'unsafe-eval'` blocks; the old production CSP blocked it too. Samples now drive Spotify's embed iframe with `postMessage` directly.
- **CSV export.** Show and episode names that start like a formula (`=`, `+`, `-`, `@`) are prefixed with `'`, so a spreadsheet can't run them.
- **Spotify keys are checked when pasted.** The Client ID and Secret must be 32 hexadecimal characters, with a message that says which one is wrong.
- **Rate limits** on manual checks (10 a minute), Spotify search (60 a minute) and link lookups (20 a minute), per user.
- **Sign-in timing** is the same whether or not an account exists.
- **Sign-in returns you** to the page you were trying to open (same-site paths only).
- **Cover art** for the chosen song is kept only from Spotify's image hosts.
- **Tests** cover the Spotify callback state check, credential changes, account deletion, the CSV export, the CSP and the unverified-operator case.

### Search and layout (branch `search-and-layout`)

- **Search as you type.** The song picker and the allow-list show search now search as you type. They wait about 300 ms after the last keystroke, start at 2 characters, and cancel a slower earlier request, so typing a full query costs about one Spotify call. The Search buttons are gone.
- **Sample before you pick.** Each song, album, or playlist result has a round green play button between its cover and its name. A ring around the button fills as the 30-second preview plays. Click again to pause. Starting another sample stops the first. Spotify's Web API gives new developer apps no preview file, so playback runs through Spotify's embed player. It stays hidden off-screen and is driven by `postMessage`. It plays a preview, or the full track when the browser is signed in to Spotify, and never touches the user's devices. The CSP allows frames from `open.spotify.com`.
- **Desktop layout.** The content column is 1320px wide, up from 1120px. Settings puts Polling and Quiet hours side by side. Account puts Signed-in devices and Delete everything side by side. On wide screens, card buttons size to their label instead of spanning the card.
- **Phone layout.** The app nav is one row that scrolls sideways under the logo, instead of wrapping onto a second line. The landing nav keeps just Sign in and the main button on phones. Checkbox labels wrap beside the box instead of under it. Cards have a little less padding.

### Replacement playback (PR #11, branch `fix-replacement-playback`)

- A replacement track plays inside its album, so Spotify doesn't go idle after the swap.
- Check now works with the blocker off. It reads the player without swapping anything.
