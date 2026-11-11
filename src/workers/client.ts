/**
 * Worker client with request coalescing: while a job runs, only the newest pending request
 * is kept, so rapid slider moves never queue up stale work and the UI stays responsive.
 */
import type { WorkerMessage } from "./protocol";

export interface JobCallbacks<T> {
  onResult: (payload: T) => void;
  onError: (message: string) => void;
  onProgress?: (message: string, fraction: number) => void;
}

interface Pending<Req, Res> {
  request: Req;
  callbacks: JobCallbacks<Res>;
}

export class CoalescingWorker<Req, Res> {
  private worker: Worker;
  private nextId = 1;
  private running: { id: number; callbacks: JobCallbacks<Res> } | null = null;
  private pending: Pending<Req, Res> | null = null;

  constructor(factory: () => Worker) {
    this.worker = factory();
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage<Res>>) => this.handle(ev.data);
    this.worker.onerror = (ev: ErrorEvent) => {
      const job = this.running;
      this.running = null;
      job?.callbacks.onError(ev.message || "Worker error");
      this.drain();
    };
  }

  get busy(): boolean {
    return this.running !== null;
  }

  submit(request: Req, callbacks: JobCallbacks<Res>): void {
    this.pending = { request, callbacks };
    this.drain();
  }

  private drain(): void {
    if (this.running || !this.pending) return;
    const { request, callbacks } = this.pending;
    this.pending = null;
    const id = this.nextId++;
    this.running = { id, callbacks };
    this.worker.postMessage({ id, request });
  }

  private handle(msg: WorkerMessage<Res>): void {
    const job = this.running;
    if (!job || msg.id !== job.id) return;
    if (msg.type === "progress") {
      // Progress from a job that has already been superseded is still shown: it is the work in flight.
      job.callbacks.onProgress?.(msg.message, msg.fraction);
      return;
    }
    this.running = null;
    const superseded = this.pending !== null;
    if (msg.type === "result") {
      if (!superseded) job.callbacks.onResult(msg.payload);
    } else if (!superseded) {
      job.callbacks.onError(msg.message);
    }
    this.drain();
  }
}
