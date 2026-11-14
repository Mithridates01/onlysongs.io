# Changelog

Changes waiting to be released, newest first. Move a section under a version heading when `dev` is released to `main`.

## Unreleased

### Search and layout (branch `search-and-layout`)

- **Search as you type.** The song picker and the allow-list show search now search as you type. They wait about 300 ms after the last keystroke, start at 2 characters, and cancel a slower earlier request, so typing a full query costs about one Spotify call. The Search buttons are gone.
- **Sample before you pick.** Each song, album, or playlist result has a Sample button. It opens Spotify's embed player under the result. It plays a 30-second preview, or the full track when the browser is signed in to Spotify. It never touches the user's devices or what they're playing. The CSP now allows frames from `open.spotify.com`.
- **Desktop layout.** The content column is 1320px wide, up from 1120px. Settings puts Polling and Quiet hours side by side. Account puts Signed-in devices and Delete everything side by side. On wide screens, card buttons size to their label instead of spanning the card.
- **Phone layout.** The app nav is one row that scrolls sideways under the logo, instead of wrapping onto a second line. The landing nav keeps just Sign in and the main button on phones. Checkbox labels wrap beside the box instead of under it. Cards have a little less padding.

### Replacement playback (PR #11, branch `fix-replacement-playback`)

- A replacement track plays inside its album, so Spotify doesn't go idle after the swap.
- Check now works with the blocker off. It reads the player without swapping anything.
