async function probe(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

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

async function maybeLoadXterm() {
  const localJs = "./vendor/xterm/xterm.js";
  const localCss = "./vendor/xterm/xterm.css";

  // CDN fallback (no build step, good enough for PoC).
  const cdnBase = "https://cdn.jsdelivr.net/npm/xterm@5.5.0";
  const cdnJs = `${cdnBase}/lib/xterm.js`;
  const cdnCss = `${cdnBase}/css/xterm.css`;

  const hasLocal = (await probe(localJs)) && (await probe(localCss));
  const js = hasLocal ? localJs : cdnJs;
  const css = hasLocal ? localCss : cdnCss;

  // If xterm isn't reachable (offline), we still want the app to run with the <pre> fallback.
  await loadCss(css);
  await loadScript(js);
}

await maybeLoadXterm();
await import("./app.js");
