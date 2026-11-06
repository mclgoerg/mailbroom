/* Test double for the demo worker: records what the page posts and lets a
 * test play the worker's side. */

import type { FromWorker, ToWorker } from "./protocol";
import { DemoRuntime, type WorkerLike } from "./runtime";

export class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: ((ev: unknown) => void) | null = null;
  /** answers a request: [status, headers, body]; default `{}` as JSON */
  answer: (m: Extract<ToWorker, { type: "req" }>)
    => [number, [string, string][], string] =
      () => [200, [["content-type", "application/json"]], "{}"];

  postMessage(m: ToWorker): void {
    this.sent.push(m);
    if (m.type === "req") {
      const [status, headers, text] = this.answer(m);
      queueMicrotask(() => this.emit({ type: "res", id: m.id, status, headers,
        body: new TextEncoder().encode(text).buffer as ArrayBuffer }));
    }
  }
  terminate(): void { this.terminated = true; }
  emit(data: FromWorker): void { this.onmessage?.({ data }); }
  get requests() {
    return this.sent.filter((m): m is Extract<ToWorker, { type: "req" }> =>
      m.type === "req");
  }
}

/** A runtime over fake workers (`made` lists them, newest last). */
export function fakeRuntime(over: { supported?: () => boolean } = {}) {
  const made: FakeWorker[] = [];
  const runtime = new DemoRuntime({
    createWorker: () => { const w = new FakeWorker(); made.push(w); return w; },
    bundle: "http://localhost/demo/bundle/",
    supported: over.supported ?? (() => true),
  });
  return { runtime, made, last: () => made[made.length - 1] };
}
