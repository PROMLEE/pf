/** Provider photos are display metadata, never an identity or authorization key. */
export function profileImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    // Older provider responses can use HTTP CDN links; avoid mixed content.
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}
