export function noticeReturnPath(source: string) {
  try {
    const id = new URL(source).searchParams.get("notice");
    return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? `/?notice=${encodeURIComponent(id)}`
      : "/";
  } catch {
    return "/";
  }
}
