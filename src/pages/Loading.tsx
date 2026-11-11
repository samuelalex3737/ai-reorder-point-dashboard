import { Loader2 } from "lucide-react";
import { useStore } from "../state/store";

export function Loading({ what }: { what: string }) {
  const progress = useStore((s) => s.progress);
  const error = useStore((s) => s.workerError);
  return (
    <div className="glass grid min-h-[320px] place-items-center p-8 text-center">
      {error ? (
        <p className="max-w-md text-sm text-rose-300">{error}</p>
      ) : (
        <div className="space-y-3">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-ai" />
          <p className="text-sm text-slate-300">Computing {what} in the background...</p>
          {progress && <p className="text-xs text-slate-500">{progress.message}</p>}
        </div>
      )}
    </div>
  );
}
