import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Lightbulb } from "lucide-react";

interface PanelProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  explain?: string;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}

/** Glass panel with a title, optional actions, and a live plain-language explanation underneath. */
export function Panel({ title, subtitle, actions, explain, busy, className = "", children }: PanelProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`glass flex min-w-0 flex-col p-4 sm:p-5 ${busy ? "shimmer" : ""} ${className}`}
      aria-busy={busy}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-slate-100">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {explain && <Explainer text={explain} />}
    </motion.section>
  );
}

export function Explainer({ text }: { text: string }) {
  return (
    <div className="mt-4 flex gap-2.5 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3 text-[13px] leading-relaxed text-slate-300">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-watch" aria-hidden />
      <p>{text}</p>
    </div>
  );
}
