export type Announcement = {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published" | "archived";
  important: boolean;
  starts_at: string | null;
  ends_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
export function announcementInput(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.title !== "string" ||
    !b.title.trim() ||
    b.title.trim().length > 120 ||
    typeof b.body !== "string" ||
    !b.body.trim() ||
    b.body.trim().length > 10000 ||
    !["draft", "published", "archived"].includes(String(b.status)) ||
    typeof b.important !== "boolean"
  )
    return null;
  function date(value: unknown) {
    return value === null || value === ""
      ? null
      : typeof value === "string" && Number.isFinite(Date.parse(value))
        ? new Date(value).toISOString()
        : undefined;
  }
  const startsAt = date(b.startsAt),
    endsAt = date(b.endsAt);
  if (
    startsAt === undefined ||
    endsAt === undefined ||
    (startsAt && endsAt && startsAt >= endsAt)
  )
    return null;
  return {
    title: b.title.trim(),
    body: b.body.trim(),
    status: b.status as Announcement["status"],
    important: b.important,
    startsAt,
    endsAt,
  };
}
