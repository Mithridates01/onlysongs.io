# Changelog

Changes waiting to be released, newest first. Move a section under a version heading when `dev` is released to `main`.

## Unreleased

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
