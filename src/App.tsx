import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { BullwhipLab } from "./pages/BullwhipLab";
import { ControlTower } from "./pages/ControlTower";
import { Forecasting } from "./pages/Forecasting";
import { Methodology } from "./pages/Methodology";
import { Optimisation } from "./pages/Optimisation";
import { Risk } from "./pages/Risk";
import { startOrchestrator } from "./state/orchestrator";
import { useStore } from "./state/store";

export default function App() {
  const status = useStore((s) => s.status);
  const loadError = useStore((s) => s.loadError);
  const page = useStore((s) => s.page);
  const skuId = useStore((s) => s.skuId);
  const controlsOpen = useStore((s) => s.controlsOpen);
  const setControlsOpen = useStore((s) => s.setControlsOpen);
  const workerError = useStore((s) => s.workerError);

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(() => startOrchestrator());
  }, []);

  if (status === "loading") {
    return (
      <div className="rack-bg grid min-h-screen place-items-center text-sm text-slate-400" role="status">
        Loading dataset and model weights...
      </div>
    );
  }
  if (status === "error") {
    return <div className="rack-bg grid min-h-screen place-items-center p-6 text-center text-sm text-rose-300">{loadError}</div>;
  }

  return (
    <div className="rack-bg min-h-screen">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl lg:block">
          <Sidebar />
        </aside>
        <AnimatePresence>
          {controlsOpen && (
            <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button className="absolute inset-0 bg-black/60" aria-label="Close controls" onClick={() => setControlsOpen(false)} />
              <motion.aside
                className="absolute left-0 top-0 h-full w-[88%] max-w-[340px] border-r border-white/10 bg-ink-900"
                initial={{ x: -340 }}
                animate={{ x: 0 }}
                exit={{ x: -340 }}
                transition={{ type: "spring", stiffness: 380, damping: 38 }}
              >
                <Sidebar onClose={() => setControlsOpen(false)} />
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="min-w-0 flex-1">
          <Header onOpenControls={() => setControlsOpen(true)} />
          <main className="px-4 py-4 lg:px-6 lg:py-6">
            {workerError && <div className="mb-4 rounded-xl border border-risk/40 bg-risk/10 p-3 text-sm text-rose-200">{workerError}</div>}
            {/* Enter-only transition: the new page mounts at once, so switching never waits on an exit animation. */}
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
                <ErrorBoundary resetKey={`${page}|${skuId}`}>
                  {page === "control" && <ControlTower />}
                  {page === "forecast" && <Forecasting />}
                  {page === "risk" && <Risk />}
                  {page === "optimise" && <Optimisation />}
                  {page === "bullwhip" && <BullwhipLab />}
                  {page === "method" && <Methodology />}
                </ErrorBoundary>
            </motion.div>
            <footer className="mt-8 pb-4 text-center text-[11px] text-slate-500">
              AI in Operations, Session II exercise. All computation runs in your browser; seeded and reproducible.
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
