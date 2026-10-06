/* iOS standalone-PWA rotation guard.
 *
 * html is a fixed, non-scrolling box and body is the scroll container
 * (index.css). After rotating an installed iOS web app, WebKit can leave
 * the *layout viewport* scrolled / the visual viewport offset from the
 * origin: the page still paints correctly, but taps land at an offset from
 * where things are drawn. html's own scroll position is never user-visible
 * here (it is overflow: hidden), so putting it back at the origin is always
 * safe - body's scroll position is left alone. */

const settleMs = 300;   // iOS reports the old size / keyboard for a moment

/** Put the (non-scrolling) document back at the origin. Returns whether
 *  anything was actually off. */
export function resetViewportOffset(win: Window = window): boolean {
  const root = win.document.documentElement;
  const vv = win.visualViewport;
  const off = root.scrollTop !== 0 || root.scrollLeft !== 0
    || win.scrollX !== 0 || win.scrollY !== 0
    || (!!vv && (vv.offsetTop !== 0 || vv.offsetLeft !== 0));
  if (off) {
    root.scrollTop = 0;
    root.scrollLeft = 0;
    win.scrollTo(0, 0);
  }
  return off;
}

/** Re-center after every orientation change (also catches the resize that
 *  desktop browsers / Android fire instead of `orientationchange`) and
 *  after a text field loses focus - the on-screen keyboard closing is the
 *  other moment iOS leaves the layout viewport scrolled (the focus-scroll
 *  that revealed the field is never undone). Returns an uninstall
 *  function. */
export function installViewportGuard(win: Window = window): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let landscape = win.innerWidth > win.innerHeight;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => resetViewportOffset(win), settleMs);
  };
  const onResize = () => {
    // Plain resizes (keyboard, URL bar) keep the same orientation.
    const now = win.innerWidth > win.innerHeight;
    if (now !== landscape) {
      landscape = now;
      settle();
    }
  };
  win.addEventListener("orientationchange", settle);
  win.addEventListener("resize", onResize);
  win.document.addEventListener("focusout", settle);
  return () => {
    clearTimeout(timer);
    win.removeEventListener("orientationchange", settle);
    win.removeEventListener("resize", onResize);
    win.document.removeEventListener("focusout", settle);
  };
}
