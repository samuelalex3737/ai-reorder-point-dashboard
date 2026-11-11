/** Shared chart styling: one semantic palette across every chart. */
import { fmt } from "../../lib/format";

export const C = {
  baseline: "#F5A524",
  ai: "#2DD4BF",
  forecast: "#38BDF8",
  risk: "#F43F5E",
  mc: "#A78BFA",
  actual: "#E2E8F0",
  muted: "#64748B",
  grid: "rgba(148,163,184,0.12)",
  axis: "rgba(148,163,184,0.35)",
  text: "#94A3B8",
  ok: "#34D399",
  random: "#F472B6",
};

export const textStyle = { color: C.text, fontFamily: "Inter Variable, Inter, system-ui, sans-serif", fontSize: 11 };

export function axis(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    nameLocation: "middle" as const,
    nameTextStyle: { color: C.text, fontSize: 11, fontWeight: 600 },
    axisLine: { lineStyle: { color: C.axis } },
    axisTick: { lineStyle: { color: C.axis } },
    axisLabel: { color: C.text, fontSize: 10.5, hideOverlap: true },
    splitLine: { lineStyle: { color: C.grid } },
    ...extra,
  };
}

export const tooltip = {
  trigger: "axis" as const,
  backgroundColor: "rgba(10,15,28,0.94)",
  borderColor: "rgba(255,255,255,0.12)",
  textStyle: { color: "#E2E8F0", fontSize: 12 },
  axisPointer: { lineStyle: { color: "rgba(148,163,184,0.5)" }, crossStyle: { color: "rgba(148,163,184,0.5)" } },
  valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v, Math.abs(v) < 10 ? 2 : 0) : String(v ?? "-")),
};

export const legend = { top: 0, textStyle: { color: C.text, fontSize: 11 }, itemWidth: 14, itemHeight: 8, icon: "roundRect" };

export function grid(extra: Record<string, unknown> = {}) {
  return { left: 64, right: 24, top: 40, bottom: 52, containLabel: false, ...extra };
}
