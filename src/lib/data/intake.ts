/**
 * New-data intake: CSV parsing and validation, manual entry validation, and the
 * "stream next period" feed (real held-back weeks first, then seeded simulation).
 *
 * Accepted CSV formats
 *  1. Kaggle daily rows: date, store_id, item_id, sales, price, promo
 *     (store_id / item_id optional; rows for other series are ignored). Aggregated to
 *     Monday-Sunday weeks; incomplete weeks are dropped with a warning.
 *  2. Weekly rows: week (or week_start), demand, promo_days (optional), price (optional),
 *     plus any other numeric columns, which become external factors (for example
 *     holiday, temperature).
 */
import Papa from "papaparse";
import { addWeeks, isMonday, mondayOf, parseDate } from "../calendar";
import { Rng } from "../rng";
import type { RowSource, WeekRow } from "../types";

export interface Issue {
  level: "error" | "warning";
  row?: number;
  message: string;
}

export interface IntakeResult {
  rows: WeekRow[];
  issues: Issue[];
  format: "daily" | "weekly" | "unknown";
  /** Number of data lines read from the file. */
  lines: number;
}

export interface IntakeContext {
  history: WeekRow[];
  basePrice: number;
  store: string;
  item: string;
}

const RESERVED = new Set(["week", "week_start", "demand", "promo_days", "promodays", "price", "date", "store_id", "item_id", "sales", "promo", "weekday", "month", "sku"]);

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || v.trim() === "") return NaN;
  return Number(v.trim());
}

function validDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s.trim()) && Number.isFinite(parseDate(s.trim()));
}

/** Median and median absolute deviation of recent demand, for outlier warnings. */
function robustScale(history: WeekRow[]): { median: number; mad: number } {
  const d = history.slice(-52).map((r) => r.demand).sort((a, b) => a - b);
  const median = d[Math.floor(d.length / 2)] ?? 0;
  const dev = d.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: dev[Math.floor(dev.length / 2)] ?? 0 };
}

/** Checks shared by every intake path: sequence, duplicates, ranges, outliers. */
export function validateNewRows(rows: WeekRow[], ctx: IntakeContext, issues: Issue[], rowOffset = 0): WeekRow[] {
  const last = ctx.history[ctx.history.length - 1];
  const sorted = [...rows].sort((a, b) => parseDate(a.week) - parseDate(b.week));
  const seen = new Set<string>();
  const { median, mad } = robustScale(ctx.history);
  let expected = addWeeks(last.week, 1);
  const out: WeekRow[] = [];
  sorted.forEach((r, i) => {
    const where = rowOffset + i + 1;
    if (seen.has(r.week)) {
      issues.push({ level: "error", row: where, message: `Week ${r.week} appears more than once.` });
      return;
    }
    seen.add(r.week);
    if (parseDate(r.week) <= parseDate(last.week)) {
      issues.push({ level: "error", row: where, message: `Week ${r.week} is already in the history (latest week is ${last.week}).` });
      return;
    }
    if (r.week !== expected) {
      issues.push({ level: "error", row: where, message: `Expected week ${expected} next, found ${r.week}. Weeks must continue the history without gaps.` });
      return;
    }
    if (!Number.isFinite(r.demand) || r.demand < 0) {
      issues.push({ level: "error", row: where, message: `Demand for ${r.week} must be a non-negative number.` });
      return;
    }
    if (!Number.isFinite(r.promoDays) || r.promoDays < 0 || r.promoDays > 7) {
      issues.push({ level: "error", row: where, message: `Promotion days for ${r.week} must be between 0 and 7.` });
      return;
    }
    if (!Number.isFinite(r.price) || r.price <= 0) {
      issues.push({ level: "error", row: where, message: `Price for ${r.week} must be positive.` });
      return;
    }
    if (mad > 0 && Math.abs(r.demand - median) > 5 * 1.4826 * mad) {
      issues.push({ level: "warning", row: where, message: `Demand ${r.demand} for ${r.week} is far from the recent median (${median}). Check it is not a data error.` });
    }
    out.push(r);
    expected = addWeeks(expected, 1);
  });
  return out;
}

export function parseCsv(text: string, ctx: IntakeContext, source: RowSource = "upload"): IntakeResult {
  const issues: Issue[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  for (const e of parsed.errors.slice(0, 5)) issues.push({ level: "error", row: (e.row ?? 0) + 1, message: `CSV parse error: ${e.message}` });
  const data = parsed.data;
  const fields = parsed.meta.fields ?? [];
  if (data.length === 0) {
    issues.push({ level: "error", message: "The file has no data rows." });
    return { rows: [], issues, format: "unknown", lines: 0 };
  }

  if (fields.includes("date") && fields.includes("sales")) {
    // Kaggle daily format.
    const weeks = new Map<string, { demand: number; promo: number; priceSum: number; days: Set<string> }>();
    let ignored = 0;
    data.forEach((r, i) => {
      if (fields.includes("store_id") && fields.includes("item_id") && (r.store_id !== ctx.store || r.item_id !== ctx.item)) {
        ignored++;
        return;
      }
      if (!validDate(r.date)) {
        issues.push({ level: "error", row: i + 2, message: `Invalid date "${r.date}" (use YYYY-MM-DD).` });
        return;
      }
      const sales = num(r.sales);
      const price = fields.includes("price") ? num(r.price) : ctx.basePrice;
      const promo = fields.includes("promo") ? num(r.promo) : 0;
      if (!Number.isFinite(sales) || sales < 0 || !Number.isFinite(price) || !Number.isFinite(promo) || (promo !== 0 && promo !== 1)) {
        issues.push({ level: "error", row: i + 2, message: "Sales must be a non-negative number, price numeric, and promo 0 or 1." });
        return;
      }
      const wk = mondayOf(r.date.trim());
      const w = weeks.get(wk) ?? { demand: 0, promo: 0, priceSum: 0, days: new Set<string>() };
      if (w.days.has(r.date.trim())) {
        issues.push({ level: "error", row: i + 2, message: `Date ${r.date} appears more than once.` });
        return;
      }
      w.days.add(r.date.trim());
      w.demand += sales;
      w.promo += promo;
      w.priceSum += price;
      weeks.set(wk, w);
    });
    if (ignored > 0) issues.push({ level: "warning", message: `${ignored} rows belong to other store/item series and were ignored (this SKU is ${ctx.store} / ${ctx.item}).` });
    const rows: WeekRow[] = [];
    for (const [week, w] of [...weeks.entries()].sort()) {
      if (w.days.size !== 7) {
        issues.push({ level: "warning", message: `Week starting ${week} has ${w.days.size} of 7 days and was skipped.` });
        continue;
      }
      rows.push({ week, demand: w.demand, promoDays: w.promo, price: Math.round((w.priceSum / 7) * 100) / 100, source });
    }
    if (issues.some((x) => x.level === "error")) return { rows: [], issues, format: "daily", lines: data.length };
    const valid = validateNewRows(rows, ctx, issues);
    return { rows: issues.some((x) => x.level === "error") ? [] : valid, issues, format: "daily", lines: data.length };
  }

  const weekCol = fields.includes("week") ? "week" : fields.includes("week_start") ? "week_start" : null;
  if (!weekCol || !fields.includes("demand")) {
    issues.push({ level: "error", message: 'Unrecognised columns. Use daily "date, sales, price, promo" or weekly "week, demand, promo_days, price".' });
    return { rows: [], issues, format: "unknown", lines: data.length };
  }
  const promoCol = fields.includes("promo_days") ? "promo_days" : fields.includes("promodays") ? "promodays" : null;
  const extraCols = fields.filter((f) => !RESERVED.has(f) && data.every((r) => r[f] === undefined || r[f] === "" || Number.isFinite(num(r[f]))));
  const rows: WeekRow[] = [];
  data.forEach((r, i) => {
    if (!validDate(r[weekCol])) {
      issues.push({ level: "error", row: i + 2, message: `Invalid week "${r[weekCol]}" (use the Monday date, YYYY-MM-DD).` });
      return;
    }
    let week = r[weekCol].trim().slice(0, 10);
    if (!isMonday(week)) {
      const m = mondayOf(week);
      issues.push({ level: "warning", row: i + 2, message: `${week} is not a Monday; aligned to the week starting ${m}.` });
      week = m;
    }
    const extra: Record<string, number> = {};
    for (const c of extraCols) if (r[c] !== undefined && r[c] !== "") extra[c] = num(r[c]);
    rows.push({
      week,
      demand: num(r.demand),
      promoDays: promoCol ? num(r[promoCol]) : 0,
      price: fields.includes("price") && r.price !== "" ? num(r.price) : ctx.basePrice,
      extra: extraCols.length ? extra : undefined,
      source,
    });
  });
  if (extraCols.length) {
    issues.push({
      level: "warning",
      message: `Extra columns detected (${extraCols.join(", ")}). They are used as external factors only when every week in the history has them.`,
    });
  }
  if (issues.some((x) => x.level === "error")) return { rows: [], issues, format: "weekly", lines: data.length };
  const valid = validateNewRows(rows, ctx, issues);
  return { rows: issues.some((x) => x.level === "error") ? [] : valid, issues, format: "weekly", lines: data.length };
}

/** Validate one manually entered week. */
export function validateManual(entry: { demand: number; promoDays: number; price: number }, ctx: IntakeContext): IntakeResult {
  const issues: Issue[] = [];
  const week = addWeeks(ctx.history[ctx.history.length - 1].week, 1);
  const rows = validateNewRows([{ week, demand: entry.demand, promoDays: entry.promoDays, price: entry.price, source: "manual" }], ctx, issues);
  return { rows: issues.some((i) => i.level === "error") ? [] : rows, issues, format: "weekly", lines: 1 };
}

/**
 * Simulated next week, used once the real held-back weeks run out. Demand = model forecast
 * for that week, adjusted for the sampled promotion days, plus a bootstrapped out-of-sample
 * error. Seeded by the history length, so the stream is reproducible.
 */
export function simulateNextWeek(history: WeekRow[], forecastMean: number, expectedPromo: number, residuals: number[], basePrice: number, discount: number): WeekRow {
  const rng = new Rng(9000 + history.length);
  const past = history[rng.int(history.length)];
  const promoDays = past.promoDays;
  const lift = promoLiftPerDay(history);
  const resid = residuals.length ? residuals[rng.int(residuals.length)] : 0;
  const demand = Math.max(0, Math.round(forecastMean * (1 + lift * (promoDays - expectedPromo)) + resid));
  return {
    week: addWeeks(history[history.length - 1].week, 1),
    demand,
    promoDays,
    price: Math.round(basePrice * (1 - (discount * promoDays) / 7) * 100) / 100,
    source: "stream-sim",
  };
}

/** Relative demand lift per promotion day, estimated against a centred 5-week moving average. */
export function promoLiftPerDay(history: WeekRow[]): number {
  let sxy = 0;
  let sxx = 0;
  const pm = history.reduce((a, r) => a + r.promoDays, 0) / history.length;
  for (let i = 2; i < history.length - 2; i++) {
    const base = (history[i - 2].demand + history[i - 1].demand + history[i].demand + history[i + 1].demand + history[i + 2].demand) / 5;
    if (base <= 0) continue;
    const x = history[i].promoDays - pm;
    sxy += x * (history[i].demand / base - 1);
    sxx += x * x;
  }
  return sxx > 0 ? Math.max(0, sxy / sxx) : 0;
}

/** Template CSV for the weekly format, continuing from the latest week. */
export function weeklyTemplate(history: WeekRow[], basePrice: number): string {
  const next = addWeeks(history[history.length - 1].week, 1);
  return `week,demand,promo_days,price\n${next},${history[history.length - 1].demand},1,${basePrice}\n`;
}
