import { motion } from "framer-motion";
import { Activity, BookOpen, Boxes, Cpu, LineChart, Network, ShieldAlert, SlidersHorizontal, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useStore, type PageKey } from "../../state/store";

const PAGES: { key: PageKey; label: string; icon: ReactNode }[] = [
  { key: "control", label: "Control Tower", icon: <Boxes className="h-4 w-4" /> },
  { key: "forecast", label: "Demand Forecasting", icon: <LineChart className="h-4 w-4" /> },
  { key: "risk", label: "Safety Stock & Risk", icon: <ShieldAlert className="h-4 w-4" /> },
  { key: "optimise", label: "AI Optimisation", icon: <Sparkles className="h-4 w-4" /> },
  { key: "bullwhip", label: "Bullwhip Lab", icon: <Network className="h-4 w-4" /> },
  { key: "method", label: "Methodology", icon: <BookOpen className="h-4 w-4" /> },
];

export function Header({ onOpenControls }: { onOpenControls: () => void }) {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const forecastBusy = useStore((s) => s.forecastBusy);
  const engineBusy = useStore((s) => s.engineBusy || (s.page === "bullwhip" && s.bwBusy));
  const progress = useStore((s) => s.progress);
  const version = useStore((s) => s.skus[s.skuId]?.versions.at(-1)?.version);
  const busy = forecastBusy || engineBusy;
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/80 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ai/30 bg-ai/10">
            <Activity className="h-5 w-5 text-ai" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-slate-100">Reorder Point Intelligence</h1>
            <p className="truncate text-[11px] text-slate-400">AI-enhanced reorder point, safety stock and sensitivity analysis</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="chip" aria-live="polite">
            <Cpu className={`h-3.5 w-3.5 ${busy ? "animate-pulse text-watch" : "text-ok"}`} />
            {busy ? (progress ? progress.message : forecastBusy ? "Retraining models" : "Optimising") : "Up to date"}
          </span>
          {version !== undefined && <span className="chip hidden sm:inline-flex">Model v{version}</span>}
          <button className="btn min-h-[36px] lg:hidden" onClick={onOpenControls}>
            <SlidersHorizontal className="h-4 w-4" /> Controls
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:px-5" aria-label="Pages">
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            aria-current={page === p.key ? "page" : undefined}
            className={`relative flex min-h-[38px] shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition ${page === p.key ? "text-slate-50" : "text-slate-400 hover:text-slate-200"}`}
          >
            {page === p.key && <motion.span layoutId="tab" className="absolute inset-0 rounded-lg border border-white/10 bg-white/[0.07]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <span className="relative flex items-center gap-2">
              {p.icon}
              {p.label}
            </span>
          </button>
        ))}
      </nav>
      {progress && (
        <div className="h-0.5 w-full bg-white/5">
          <div className="h-full bg-ai transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </div>
      )}
    </header>
  );
}
