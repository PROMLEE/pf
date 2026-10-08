"use client";

export const ASSET_SORT_OPTIONS = [
  ["value-desc", "평가액 높은순"],
  ["value-asc", "평가액 낮은순"],
  ["gain-desc", "손익 높은순"],
  ["gain-asc", "손익 낮은순"],
  ["return-desc", "수익률 높은순"],
  ["return-asc", "수익률 낮은순"],
  ["name-asc", "이름순"],
] as const;
export type AssetSort = (typeof ASSET_SORT_OPTIONS)[number][0];
export function isAssetSort(value: string | null): value is AssetSort {
  return ASSET_SORT_OPTIONS.some(([key]) => key === value);
}
export function compareAssets(
  a: { name: string; value: number | null; gain: number | null; gainPercent: number | null },
  b: { name: string; value: number | null; gain: number | null; gainPercent: number | null },
  sort: AssetSort,
) {
  const byName = a.name.localeCompare(b.name, "ko");
  if (sort === "name-asc") return byName;
  const field = sort.startsWith("value") ? "value" : sort.startsWith("gain") ? "gain" : "gainPercent";
  const left = a[field];
  const right = b[field];
  if (left === null || right === null) return left === right ? byName : left === null ? 1 : -1;
  return (sort.endsWith("asc") ? left - right : right - left) || byName;
}
export default function AssetSortSelect({ value, onChange, className, marketGrouped = false }: {
  value: AssetSort;
  onChange: (value: AssetSort) => void;
  className?: string;
  marketGrouped?: boolean;
}) {
  return <select aria-label="자산 정렬 기준" className={className} value={value} onChange={(event) => {
    if (isAssetSort(event.target.value)) onChange(event.target.value);
  }}>
    {ASSET_SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}{marketGrouped && (key.startsWith("value") || key.startsWith("gain")) ? " (시장별)" : ""}</option>)}
  </select>;
}
