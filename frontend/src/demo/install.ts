/* Routes the UI's /api/* calls to the in-browser backend. One intercept on
 * window.fetch covers req() and every direct fetch() the UI makes (downloads,
 * rule/preset DELETE, /api/version, the backup upload) with no edits there,
 * and hands back real Response objects (json, blob, Content-Disposition).
 * Never loaded by the production build (main.tsx imports it in demo builds
 * only). */

import type { DemoRuntime } from "./runtime";

export function installDemo(runtime: DemoRuntime): void {
  // No server-sent events: the worker finishes every job inside the request
  // that started it, and App falls back to polling when this throws.
  (window as unknown as { EventSource: unknown }).EventSource =
    class { constructor() { throw new Error("no event stream in the demo"); } };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(
      req ? req.url : input instanceof URL ? input.href : String(input),
      location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return realFetch(input, init);
    }
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? req?.headers).forEach((v, k) => { headers[k] = v; });
    return runtime.request(method, url.pathname, url.search.slice(1),
      await bodyOf(init?.body, req), headers);
  };
}

async function bodyOf(body: BodyInit | null | undefined, req: Request | null
): Promise<string | Uint8Array | null> {
  if (body == null) {
    return req && req.method !== "GET" && req.method !== "HEAD"
      ? new Uint8Array(await req.clone().arrayBuffer()) : null;
  }
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return new Uint8Array(await new Response(body).arrayBuffer());
}
