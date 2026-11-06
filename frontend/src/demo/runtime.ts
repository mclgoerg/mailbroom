/* The page's end of the demo: owns the worker that runs the real backend
 * (Pyodide), tracks how far booting got, and answers requests. The fetch
 * intercept (install.ts) and the boot screen (DemoBoot.tsx) sit on top. */

import { setClockShift } from "../clock";
import { STEPS, type FromWorker, type StepId, type ToWorker } from "./protocol";

export type FailReason = "unsupported" | "stalled" | "error";

export type BootState =
  | { phase: "booting"; step: StepId; done: StepId[];
      /** download step: megabytes received / expected (0 until known) */
      mb: number; totalMb: number }
  | { phase: "ready" }
  | { phase: "failed"; reason: FailReason };

/** The slice of Worker the runtime uses (tests pass a fake). */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: FromWorker }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
}

/** No sign of life from the worker for this long = something is stuck. The
 *  download reports every chunk, so it gets the shorter leash; the other
 *  steps are one long call each (slow phones need minutes, not seconds). */
export const STALL_MS: Record<StepId, number> = {
  download: 30_000, python: 120_000, libraries: 120_000, seed: 120_000,
};

/** One backend call that has not come back after this long gets a 504 (a
 *  Python call that never returns would otherwise hang its fetch forever).
 *  Generous: a slow phone's first /api/state takes tens of seconds. */
export const REQUEST_TIMEOUT_MS = 120_000;

const MB = 1e6;

export function browserSupportsDemo(): boolean {
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
    return false;
  }
  // Module workers: the constructor reads `type` only if it knows the option.
  let module = false;
  try {
    const url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
    try {
      const w = new Worker(url, { get type(): WorkerType { module = true; return "module"; } });
      w.terminate();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return false;
  }
  return module;
}

export class DemoRuntime {
  private worker: WorkerLike | null = null;
  private state: BootState = { phase: "booting", step: "download", done: [],
    mb: 0, totalMb: 0 };
  private listeners = new Set<() => void>();
  private pending = new Map<number, {
    resolve: (r: Response) => void; reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private stall: ReturnType<typeof setTimeout> | undefined;

  constructor(private opts: {
    createWorker: () => WorkerLike;
    /** absolute URL of the bundle folder */
    bundle: string;
    supported?: () => boolean;
  }) {}

  getState = (): BootState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  private set(s: BootState): void {
    this.state = s;
    this.listeners.forEach((l) => l());
  }

  /** (Re)boots: a fresh worker, so nothing of the previous session (backend
   *  state, module caches) survives - that is also what "Reset demo" does. */
  start(): void {
    this.dispose();
    this.set({ phase: "booting", step: "download", done: [], mb: 0, totalMb: 0 });
    if (!(this.opts.supported ?? browserSupportsDemo)()) {
      this.fail("unsupported");
      return;
    }
    let w: WorkerLike;
    try {
      w = this.opts.createWorker();
    } catch {
      this.fail("unsupported");
      return;
    }
    this.worker = w;
    w.onmessage = (ev) => { if (this.worker === w) this.onMessage(ev.data); };
    w.onerror = w.onmessageerror = () => { if (this.worker === w) this.fail("error"); };
    this.watch("download");
    w.postMessage({ type: "boot", bundle: this.opts.bundle });
  }

  private onMessage(m: FromWorker): void {
    const s = this.state;
    if (m.type === "res") {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (p) clearTimeout(p.timer);
      p?.resolve(toResponse(m.status, m.headers, m.body));
    } else if (s.phase !== "booting") {
      return;
    } else if (m.type === "progress") {
      const at = STEPS.indexOf(m.step);
      this.set({
        phase: "booting", step: m.step, done: STEPS.slice(0, at),
        mb: m.step === "download" && m.total
          ? Math.min(m.wire ?? m.total, (m.wire ?? m.total) * (m.done ?? 0) / m.total) / MB
          : s.mb,
        totalMb: m.step === "download" && m.total ? (m.wire ?? m.total) / MB
          : s.totalMb,
      });
      this.watch(m.step);
    } else if (m.type === "ready") {
      clearTimeout(this.stall);
      setClockShift(m.clockShiftMs);
      this.set({ phase: "ready" });
    } else if (m.type === "fatal") {
      console.error("demo worker failed:", m.error);
      this.fail("error");
    }
  }

  /** (Re)arms the "nothing is happening" timer for the running step. */
  private watch(step: StepId): void {
    clearTimeout(this.stall);
    this.stall = setTimeout(() => this.fail("stalled"), STALL_MS[step]);
  }

  private fail(reason: FailReason): void {
    this.dispose();
    this.set({ phase: "failed", reason });
  }

  private dispose(): void {
    clearTimeout(this.stall);
    const w = this.worker;
    this.worker = null;
    if (w) { w.onmessage = w.onerror = w.onmessageerror = null; w.terminate(); }
    // what was in flight will never be answered: a network error, like a
    // dropped connection (callers handle those already)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new TypeError("Failed to fetch"));
    }
    this.pending.clear();
  }

  /** One backend call. Rejects with a TypeError when there is no backend
   *  (booting, failed, being reset), like fetch does offline. */
  request(method: string, path: string, query: string,
          body: string | Uint8Array | null, headers: Record<string, string>
  ): Promise<Response> {
    const w = this.worker;
    if (!w || this.state.phase !== "ready") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(new Response(JSON.stringify({ detail: "demo request timed out" }),
          { status: 504, headers: { "content-type": "application/json" } }));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage({ type: "req", id, method, path, query, body, headers });
    });
  }
}

const NULL_BODY = new Set([101, 204, 205, 304]);

function toResponse(status: number, headers: [string, string][],
                    body: ArrayBuffer): Response {
  return new Response(NULL_BODY.has(status) ? null : body, { status, headers });
}
