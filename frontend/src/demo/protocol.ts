/* Messages between the page and the demo worker (demo/worker.ts). */

export type StepId = "download" | "python" | "libraries" | "seed";
export const STEPS: StepId[] = ["download", "python", "libraries", "seed"];

/** Page -> worker. `bundle` is the absolute URL of the folder holding the
 *  demo bundle (manifest.json and what it names, scripts/demo-bundle). */
export type ToWorker =
  | { type: "boot"; bundle: string }
  | { type: "req"; id: number; method: string; path: string; query: string;
      body: string | Uint8Array | null; headers: Record<string, string> };

/** Worker -> page. For `download`, `done`/`total` are the bytes received and
 *  the bytes expected (after decompression) and `wire` the transfer size the
 *  manifest estimates, so the page can show honest megabytes. */
export type FromWorker =
  | { type: "progress"; step: StepId; done?: number; total?: number;
      wire?: number }
  | { type: "ready"; clockShiftMs: number }
  | { type: "fatal"; error: string }
  | { type: "res"; id: number; status: number; headers: [string, string][];
      body: ArrayBuffer };
