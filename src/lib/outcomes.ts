export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "replaced":
      return "Replaced the podcast with your song.";
    case "replaced_via_next":
      return "The device refused a direct play, so the app skipped to the next item.";
    case "idle":
      return "Nothing is playing.";
    case "music":
      return "Music is playing. Left it alone.";
    case "ignored":
    case "ignored_audiobook":
      return "An audiobook is playing. Audiobook blocking is off, so it was left alone.";
    case "ignored_podcast":
      return "A podcast is playing. Podcast blocking is off, so it was left alone.";
    case "allow_listed":
      return "That show or audiobook is on the allow list.";
    case "quiet_hours":
      return "Quiet hours are active, so podcasts and audiobooks are allowed right now.";
    case "cooldown":
      return "Cooling down after the last swap.";
    case "paused":
    case "rate_limited":
      return "Spotify rate-limited this account. Checks will resume when the pause ends.";
    case "quota":
      return "Spotify quota is exceeded. This account is paused for one hour.";
    case "broken":
      return "Spotify access was revoked. Reconnect to turn the blocker back on.";
    case "no_device":
      return "No active device accepted the swap.";
    case "restricted":
      return "That device rejected remote control. The episode was logged and left playing.";
    case "not_connected":
      return "Spotify is not connected.";
    case "no_replacement":
      return "Pick a replacement song before turning the blocker on.";
    case "disabled":
      return "The blocker is off.";
    case "busy":
      return "A check is already running.";
    case "error":
      return "Spotify did not answer. The next check will try again.";
    case "failed":
      return "The swap failed. It will be tried again on the next check.";
    default:
      return outcome.replaceAll("_", " ");
  }
}

export function resultLabel(result: string): string {
  switch (result) {
    case "replaced":
      return "Replaced";
    case "replaced_via_next":
      return "Skipped next";
    case "allow_listed":
      return "Allow list";
    case "no_device":
      return "No device";
    case "restricted":
      return "Device rejected";
    case "failed":
      return "Failed";
    case "rate_limited":
      return "Rate limited";
    case "quota":
      return "Quota exceeded";
    case "broken":
      return "Reconnect needed";
    default:
      return result.replaceAll("_", " ");
  }
}
