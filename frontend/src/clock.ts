/* The UI's "now". Production reads the real clock. The in-browser demo's
 * backend runs on the clock of its seed's build instant (backend/demo.py,
 * demo_seed.set_clock), so the demo build shifts the page's "now" back by the
 * same amount (demo/runtime.ts calls setClockShift): ages, "this month" and
 * client-side `age:` filtering then agree with the server. Anything that
 * compares a server timestamp with "now" must use these, not Date.now(). */

let shiftMs = 0;

/** Demo only: "now" reads the real time minus `ms`. 0 restores the real clock. */
export function setClockShift(ms: number): void {
  shiftMs = ms;
}

/** Milliseconds since the epoch, like Date.now(). */
export const nowMs = (): number => Date.now() - shiftMs;

/** A Date at "now", like new Date(). */
export const nowDate = (): Date => new Date(nowMs());
