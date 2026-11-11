/** Display formatting. */

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmt(x: number | null | undefined, decimals = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  return decimals === 0 ? nf0.format(x) : decimals === 1 ? nf1.format(x) : decimals === 2 ? nf2.format(x) : x.toFixed(decimals);
}

export function money(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  return `$${nf0.format(x)}`;
}

export function pct(x: number | null | undefined, decimals = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  return `${(x * 100).toFixed(decimals)}%`;
}

/** Signed change with an explicit plus sign. */
export function signed(x: number, decimals = 0): string {
  const s = fmt(Math.abs(x), decimals);
  return x > 0 ? `+${s}` : x < 0 ? `-${s}` : s;
}

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}
