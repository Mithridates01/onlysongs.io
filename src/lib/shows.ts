export type AllowedShow = { id: string; name: string };

export function readAllowedShows(value: unknown): AllowedShow[] {
  if (!Array.isArray(value)) return [];
  const shows: AllowedShow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; name?: unknown };
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    shows.push({ id: record.id, name: record.name });
  }
  return shows;
}
