export function pushSubscriptionInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (typeof body.endpoint !== "string" || body.endpoint.length > 2048)
    return null;
  try {
    const url = new URL(body.endpoint);
    const allowed =
      url.hostname === "fcm.googleapis.com" ||
      url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname === "web.push.apple.com" ||
      url.hostname.endsWith(".notify.windows.com");
    if (
      !allowed ||
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  if (
    typeof body.keys?.p256dh !== "string" ||
    !/^[A-Za-z0-9_-]{87}$/.test(body.keys.p256dh) ||
    typeof body.keys.auth !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(body.keys.auth)
  )
    return null;
  return {
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
  };
}
