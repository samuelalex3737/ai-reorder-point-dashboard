import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { fmt } from "../../lib/format";

/** Number that tweens smoothly to its new value. */
export function AnimatedNumber({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => `${prefix}${fmt(v, decimals)}${suffix}`);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(value)) {
      mv.set(value);
      return;
    }
    const ctl = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return () => ctl.stop();
  }, [value, mv]);
  return <motion.span className="num">{text}</motion.span>;
}

interface KpiProps {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  sub?: ReactNode;
  tone?: "ai" | "baseline" | "risk" | "forecast" | "mc" | "neutral";
  icon?: ReactNode;
}

const toneClass: Record<NonNullable<KpiProps["tone"]>, string> = {
  ai: "text-ai",
  baseline: "text-baseline",
  risk: "text-risk",
  forecast: "text-forecast",
  mc: "text-mc",
  neutral: "text-slate-100",
};

export function Kpi({ label, value, decimals = 0, prefix, suffix, sub, tone = "neutral", icon }: KpiProps) {
  return (
    <div className="glass flex min-w-0 flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label leading-tight">{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${toneClass[tone]}`}>
        <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </div>
      {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
