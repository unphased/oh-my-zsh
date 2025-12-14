function loadCss(href) {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
  });
}

function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

async function tryLoadXtermPair({ css, js, label }) {
  const cssOk = await loadCss(css);
  const jsOk = await loadScript(js);
  const ok = cssOk && jsOk && typeof window.Terminal === "function";
  if (ok) {
    window.__TERM_CAPTURE_XTERM_SOURCE = label;
  }
  return ok;
}

async function tryLoadXtermEsm() {
  try {
    // Uses CORS-friendly ESM CDN. This works when you serve `web/` over HTTP.
    const mod = await import("https://esm.sh/xterm@5.5.0");
    if (mod && typeof mod.Terminal === "function") {
      window.Terminal = mod.Terminal;
      window.__TERM_CAPTURE_XTERM_SOURCE = "esm.sh (ESM import)";
      // CSS still needs to be loaded separately.
      await loadCss("https://cdn.jsdelivr.net/npm/xterm@5.5.0/css/xterm.css");
      return true;
    }
  } catch {
    // ignored: we'll fall back to <pre> mode
  }
  return false;
}

async function maybeLoadXterm() {
  // Prefer local vendoring for offline use and reproducibility.
  if (
    await tryLoadXtermPair({
      label: "local vendored",
      css: "./vendor/xterm/xterm.css",
      js: "./vendor/xterm/xterm.js",
    })
  ) {
    return;
  }

  // CDN fallbacks (UMD/global build). If these fail, we still run in <pre> mode.
  const cdnPairs = [
    {
      label: "jsdelivr",
      css: "https://cdn.jsdelivr.net/npm/xterm@5.5.0/css/xterm.css",
      js: "https://cdn.jsdelivr.net/npm/xterm@5.5.0/lib/xterm.js",
    },
    {
      label: "unpkg",
      css: "https://unpkg.com/xterm@5.5.0/css/xterm.css",
      js: "https://unpkg.com/xterm@5.5.0/lib/xterm.js",
    },
  ];

  for (const pair of cdnPairs) {
    // eslint-disable-next-line no-await-in-loop
    if (await tryLoadXtermPair(pair)) return;
  }

  // Last resort: ESM import and wire it to window.Terminal.
  await tryLoadXtermEsm();
}

await maybeLoadXterm();
await import("./app.js");
