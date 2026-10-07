export function domesticPreviousClose(
  output: Record<string, unknown>,
): number | null {
  const price = Number(output.stck_prpr);
  const rawChange = output.prdy_vrss;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    rawChange == null ||
    String(rawChange).trim() === ""
  )
    return null;

  const change = Number(rawChange);
  if (!Number.isFinite(change)) return null;
  const sign = String(output.prdy_vrss_sign ?? "");
  const signedChange = ["4", "5"].includes(sign)
    ? -Math.abs(change)
    : ["1", "2"].includes(sign)
      ? Math.abs(change)
      : sign === "3"
        ? 0
        : change;
  const previousClose = price - signedChange;
  return previousClose > 0 ? previousClose : null;
}
