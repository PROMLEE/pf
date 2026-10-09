export function numberInputString(value: string | number) {
  return typeof value === "number"
    ? value.toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 20,
      })
    : value;
}

/** Group the integer part without rounding fractional quantities or prices. */
export function groupNumberInput(value: string | number) {
  const [integer, fraction] = numberInputString(value).split(".");
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction === undefined ? "" : `.${fraction}`)
  );
}

export function rawNumberInput(value: string) {
  const raw = value.replace(/,/g, "");
  if (!/^\d*(?:\.\d*)?$/.test(raw)) return null;
  return raw.startsWith(".") ? `0${raw}` : raw;
}
