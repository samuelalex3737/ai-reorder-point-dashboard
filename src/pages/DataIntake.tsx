/** Add new data: CSV upload with validation, manual entry, and the "stream next period" feed. */
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Download, FastForward, FileUp, Plus, RotateCcw, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { NumberField, Segmented } from "../components/ui/Controls";
import { Panel } from "../components/ui/Panel";
import { addWeeks } from "../lib/calendar";
import { parseCsv, validateManual, weeklyTemplate, type IntakeResult } from "../lib/data/intake";
import { fmt } from "../lib/format";
import { useForecast, useSku } from "../state/hooks";
import { useStore } from "../state/store";

type Mode = "stream" | "upload" | "manual";

export function DataIntake() {
  const { series, state, history } = useSku();
  const { stale } = useForecast();
  const addRows = useStore((s) => s.addRows);
  const undoLast = useStore((s) => s.undoLast);
  const resetData = useStore((s) => s.resetData);
  const retrainLstm = useStore((s) => s.retrainLstm);
  const holdout = useStore((s) => s.dataset!.holdoutWeeks);
  const [mode, setMode] = useState<Mode>("stream");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<IntakeResult | null>(null);
  const [fileName, setFileName] = useState("");
  const last = history[history.length - 1];
  const [manual, setManual] = useState({ demand: last.demand, promoDays: 0, price: series.basePrice });
  const fileRef = useRef<HTMLInputElement>(null);
  const ctx = { history, basePrice: series.basePrice, store: series.store, item: series.item };
  const realLeft = state.added.every((r) => r.source === "stream-real") ? holdout - state.cursor : 0;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setMsg(null);
    if (f.size > 25 * 1024 * 1024) {
      setPending({ rows: [], issues: [{ level: "error", message: "File is larger than 25 MB; upload only the new weeks." }], format: "unknown", lines: 0 });
      return;
    }
    setPending(parseCsv(await f.text(), ctx));
  };

  const stream = (n: number) => {
    let last: string = "";
    for (let i = 0; i < n; i++) {
      const r = useStore.getState().streamNext();
      last = r.message;
      if (!r.ok) break;
    }
    setMsg(n > 1 ? `Streamed ${n} weeks. ${last}` : last);
  };

  const downloadTemplate = () => {
    const blob = new Blob([weeklyTemplate(history, series.basePrice)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `new-weeks-${series.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const manualResult = validateManual(manual, ctx);

  return (
    <Panel
      title="Add new data"
      subtitle={`History: ${history.length} weeks to ${last.week}. Each change retrains all 7 models in the background.`}
      busy={stale}
      explain={`New weeks are validated (continuity, ranges, duplicates, outliers) before they are accepted. The stream releases the ${holdout} real weeks held back from the end of 2023 (${realLeft} left), then switches to simulated weeks drawn from the best model plus a real forecast error. After each change the LSTM is fine-tuned for a few epochs from its previous weights while the other models refit from scratch.`}
    >
      <Segmented
        ariaLabel="How to add data"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setMsg(null);
        }}
        options={[
          { value: "stream", label: "Stream next period" },
          { value: "upload", label: "CSV upload" },
          { value: "manual", label: "Manual entry" },
        ]}
      />

      <div className="mt-4 min-h-[150px]">
        {mode === "stream" && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-300">
              Next week: <span className="num text-slate-100">{addWeeks(last.week, 1)}</span> ({realLeft > 0 ? "real held-back data" : "simulated from the best model"})
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => stream(1)}>
                <Plus className="h-4 w-4" /> Stream 1 week
              </button>
              <button className="btn" onClick={() => stream(4)}>
                <FastForward className="h-4 w-4" /> Stream 4 weeks
              </button>
            </div>
          </div>
        )}

        {mode === "upload" && (
          <div className="space-y-3">
            <label
              className="flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center text-[13px] text-slate-300 transition hover:border-ai/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <FileUp className="h-5 w-5 text-ai" />
              <span>{fileName || "Drop a CSV here or click to choose"}</span>
              <span className="text-[11px] text-slate-500">Weekly: week, demand, promo_days, price (+ any numeric factors). Daily Kaggle rows are aggregated.</span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <button className="btn min-h-[34px] text-xs" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" /> Download a template for the next week
            </button>
            {pending && (
              <div className="space-y-2">
                <ul className="max-h-[140px] space-y-1 overflow-auto text-xs">
                  {pending.issues.length === 0 && <li className="text-ok">No issues found in {pending.lines} lines.</li>}
                  {pending.issues.map((i, k) => (
                    <li key={k} className={i.level === "error" ? "text-rose-300" : "text-amber-200"}>
                      {i.level === "error" ? "Error" : "Warning"}
                      {i.row ? ` (row ${i.row})` : ""}: {i.message}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-primary"
                  disabled={pending.rows.length === 0}
                  onClick={() => {
                    addRows(pending.rows, `Uploaded ${pending.rows.length} week(s) from ${fileName}`);
                    setMsg(`Added ${pending.rows.length} week(s) from ${fileName}.`);
                    setPending(null);
                    setFileName("");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  <Plus className="h-4 w-4" /> Add {pending.rows.length} valid week(s)
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-300">
              Week starting <span className="num text-slate-100">{addWeeks(last.week, 1)}</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Demand" value={manual.demand} onChange={(v) => setManual({ ...manual, demand: v })} suffix="units" />
              <NumberField label="Promo days" value={manual.promoDays} onChange={(v) => setManual({ ...manual, promoDays: v })} suffix="0-7" />
              <NumberField label="Price" value={manual.price} step={0.01} onChange={(v) => setManual({ ...manual, price: v })} suffix="$" />
            </div>
            {manualResult.issues.map((i, k) => (
              <p key={k} className={`text-xs ${i.level === "error" ? "text-rose-300" : "text-amber-200"}`}>
                {i.message}
              </p>
            ))}
            <button
              className="btn btn-primary"
              disabled={manualResult.rows.length === 0}
              onClick={() => {
                addRows(manualResult.rows, `Manual entry ${manualResult.rows[0].week}`);
                setMsg(`Added week ${manualResult.rows[0].week} with demand ${fmt(manual.demand)}.`);
              }}
            >
              <Plus className="h-4 w-4" /> Add week
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {msg && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 text-xs text-ai" role="status">
            {msg}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
        <button className="btn min-h-[34px] text-xs" onClick={undoLast} disabled={state.added.length === 0}>
          <Undo2 className="h-3.5 w-3.5" /> Undo last week
        </button>
        <button className="btn min-h-[34px] text-xs" onClick={() => void resetData()} disabled={state.added.length === 0 && state.versions.length <= 1}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset all SKUs to dataset
        </button>
        <button className="btn min-h-[34px] text-xs" onClick={retrainLstm} title="Retrain the LSTM from scratch in the browser (about 120 epochs)">
          <Brain className="h-3.5 w-3.5" /> Retrain LSTM from scratch
        </button>
      </div>
    </Panel>
  );
}
