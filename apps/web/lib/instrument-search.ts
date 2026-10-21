type SearchableInstrument = { symbol: string; name: string };

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s()[\]{}.,…·ㆍ-]/g, "");
}

/** Keep exact matches first; partial codes match only from the start. */
export function searchInstrumentCatalog<T extends SearchableInstrument>(
  catalog: readonly T[],
  query: string,
): T[] {
  const needle = normalize(query);
  if (!needle) return [];
  const exact = catalog.filter(
    (item) =>
      normalize(item.symbol) === needle || normalize(item.name) === needle,
  );
  if (exact.length) return exact.slice(0, 12);
  return catalog
    .filter(
      (item) =>
        normalize(item.symbol).startsWith(needle) ||
        normalize(item.name).includes(needle),
    )
    .sort(
      (a, b) =>
        Number(normalize(b.symbol).startsWith(needle)) -
          Number(normalize(a.symbol).startsWith(needle)) ||
        a.name.localeCompare(b.name, "ko-KR"),
    )
    .slice(0, 12);
}
