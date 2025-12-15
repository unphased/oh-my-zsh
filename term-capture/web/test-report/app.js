function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el;
}

const els = {
  url: $("url"),
  loadUrl: $("loadUrl"),
  file: $("file"),
  filter: $("filter"),
  showPassed: $("showPassed"),
  expandAll: $("expandAll"),
  collapseAll: $("collapseAll"),
  meta: $("meta"),
  errors: $("errors"),
  cases: $("cases"),
};

let report = null;

function asText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function safeGet(obj, path, fallback = undefined) {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return cur;
}

function makePill(label, value, cls) {
  const span = document.createElement("span");
  span.className = `pill ${cls || ""}`.trim();
  span.textContent = `${label}: ${value}`;
  return span;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderMeta(obj, sourceLabel) {
  clear(els.meta);
  const meta = obj.metadata || {};
  const totals = safeGet(obj, ["test-run", "totals"], {});
  const a = totals.assertions || {};
  const t = totals["test-cases"] || {};

  const kv = document.createElement("div");
  kv.className = "kv";
  const put = (k, v) => {
    const kk = document.createElement("div");
    kk.className = "k";
    kk.textContent = k;
    const vv = document.createElement("div");
    vv.textContent = asText(v);
    kv.appendChild(kk);
    kv.appendChild(vv);
  };

  put("source", sourceLabel);
  put("name", meta.name || "");
  put("catch2", meta["catch2-version"] || "");
  put("rng-seed", meta["rng-seed"] ?? "");

  els.meta.appendChild(kv);

  els.meta.appendChild(makePill("tests", (t.passed || 0) + (t.failed || 0) + (t.skipped || 0), "warn"));
  els.meta.appendChild(makePill("test failed", t.failed || 0, (t.failed || 0) ? "bad" : "ok"));
  els.meta.appendChild(makePill("assert failed", a.failed || 0, (a.failed || 0) ? "bad" : "ok"));
  els.meta.appendChild(makePill("assert passed", a.passed || 0, "ok"));
}

function renderError(message) {
  els.errors.hidden = false;
  clear(els.errors);
  const pre = document.createElement("pre");
  pre.style.margin = "0";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = message;
  els.errors.appendChild(pre);
}

function hideError() {
  els.errors.hidden = true;
  clear(els.errors);
}

function matchesFilter(testInfo, q) {
  if (!q) return true;
  q = q.toLowerCase();
  const name = (testInfo?.name || "").toLowerCase();
  const tags = (testInfo?.tags || []).join(" ").toLowerCase();
  const file = safeGet(testInfo, ["source-location", "filename"], "").toLowerCase();
  return name.includes(q) || tags.includes(q) || file.includes(q);
}

function countAssertionsInPath(pathNode) {
  let passed = 0;
  let failed = 0;

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "assertion") {
      if (node.status) passed += 1;
      else failed += 1;
      return;
    }
    const children = node.path;
    if (Array.isArray(children)) {
      for (const c of children) walk(c);
    }
  }

  walk(pathNode);
  return { passed, failed };
}

function renderAssertionsTree(container, nodes, indent, showPassed) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node.kind === "assertion") {
      const ok = !!node.status;
      if (ok && !showPassed) continue;
      const row = document.createElement("div");
      row.className = `assertion ${ok ? "ok" : "bad"}`;
      row.style.marginLeft = `${indent}px`;

      const status = document.createElement("div");
      status.className = "status";
      status.textContent = ok ? "✓" : "✗";

      const msg = document.createElement("div");
      const loc =
        safeGet(node, ["source-location", "filename"], "") + ":" + safeGet(node, ["source-location", "line"], "");
      msg.innerHTML = `<span class="loc">${loc}</span> ${ok ? "" : "(failed)"}`;

      row.appendChild(status);
      row.appendChild(msg);
      container.appendChild(row);
      continue;
    }

    if (node.kind === "section") {
      const title = document.createElement("div");
      title.className = "assertion";
      title.style.marginLeft = `${indent}px`;
      const status = document.createElement("div");
      status.className = "status";
      status.textContent = "»";
      const msg = document.createElement("div");
      msg.textContent = node.name || "(section)";
      title.appendChild(status);
      title.appendChild(msg);
      container.appendChild(title);

      renderAssertionsTree(container, node.path, indent + 14, showPassed);
      continue;
    }

    // Unknown nodes: still traverse their children if present.
    if (Array.isArray(node.path)) renderAssertionsTree(container, node.path, indent, showPassed);
  }
}

function renderCases(obj) {
  clear(els.cases);
  const q = els.filter.value.trim();
  const showPassed = els.showPassed.checked;
  const testCases = safeGet(obj, ["test-run", "test-cases"], []);

  let shown = 0;
  for (const tc of testCases) {
    const testInfo = tc["test-info"];
    if (!matchesFilter(testInfo, q)) continue;
    shown += 1;

    const name = testInfo?.name || "(unnamed test)";
    const tags = (testInfo?.tags || []).join(" ");
    const src = safeGet(testInfo, ["source-location", "filename"], "") + ":" + safeGet(testInfo, ["source-location", "line"], "");

    const details = document.createElement("details");
    details.open = false;

    const summary = document.createElement("summary");
    const left = document.createElement("div");
    left.className = "caseTitle";
    left.textContent = name;

    const right = document.createElement("div");
    right.className = "caseMeta";
    if (tags) right.appendChild(makePill("tags", tags, ""));
    if (src && src !== ":") right.appendChild(makePill("src", src, ""));

    summary.appendChild(left);
    summary.appendChild(right);
    details.appendChild(summary);

    const runs = tc.runs || [];
    for (const run of runs) {
      const runEl = document.createElement("div");
      runEl.className = "run";
      const idx = run["run-idx"];

      const pathNodes = run.path || [];
      let passed = 0;
      let failed = 0;
      for (const pn of pathNodes) {
        const c = countAssertionsInPath(pn);
        passed += c.passed;
        failed += c.failed;
      }

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.gap = "10px";
      header.style.flexWrap = "wrap";
      header.appendChild(makePill("run", idx, ""));
      header.appendChild(makePill("assert failed", failed, failed ? "bad" : "ok"));
      header.appendChild(makePill("assert passed", passed, "ok"));

      runEl.appendChild(header);

      const tree = document.createElement("div");
      tree.className = "indent";
      renderAssertionsTree(tree, pathNodes, 0, showPassed);
      runEl.appendChild(tree);

      details.appendChild(runEl);
    }

    els.cases.appendChild(details);
  }

  if (shown === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.textContent = "No tests matched.";
    els.cases.appendChild(empty);
  }
}

function expandCollapseAll(open) {
  for (const d of els.cases.querySelectorAll("details")) {
    d.open = open;
  }
}

async function loadFromUrl(url) {
  hideError();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);
  const obj = await res.json();
  report = obj;
  renderMeta(obj, url);
  renderCases(obj);
}

async function loadFromFile(file) {
  hideError();
  const text = await file.text();
  const obj = JSON.parse(text);
  report = obj;
  renderMeta(obj, file.name);
  renderCases(obj);
}

function wire() {
  els.loadUrl.addEventListener("click", async () => {
    try {
      await loadFromUrl(els.url.value.trim());
    } catch (e) {
      renderError(String(e?.stack || e));
    }
  });

  els.file.addEventListener("change", async () => {
    const f = els.file.files && els.file.files[0];
    if (!f) return;
    try {
      await loadFromFile(f);
    } catch (e) {
      renderError(String(e?.stack || e));
    } finally {
      els.file.value = "";
    }
  });

  els.filter.addEventListener("input", () => {
    if (!report) return;
    renderCases(report);
  });
  els.showPassed.addEventListener("change", () => {
    if (!report) return;
    renderCases(report);
  });

  els.expandAll.addEventListener("click", () => expandCollapseAll(true));
  els.collapseAll.addEventListener("click", () => expandCollapseAll(false));
}

wire();

// Auto-load the default URL on startup (best-effort).
loadFromUrl(els.url.value.trim()).catch((e) => renderError(String(e?.stack || e)));
