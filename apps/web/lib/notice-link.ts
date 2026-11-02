export function noticeReturnPath(source: string) {
  try {
    const params = new URL(source).searchParams;
    if (params.get("view") === "rebalance") return "/?view=rebalance";
    const id = params.get("notice");
    return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? `/?notice=${encodeURIComponent(id)}`
      : "/";
  } catch {
    return "/";
  }
}
