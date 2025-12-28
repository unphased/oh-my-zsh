# term-capture web viewer (offline PoC)

This is a tiny framework-free web “beachhead” for dogfooding term-capture logs without waiting for WebSockets.

## What it does
- Loads an existing `<prefix>.output` / `<prefix>.input` via the browser File API (top bar “File” buttons or drag/drop).
- Replays bytes into:
  - **xterm.js** if you vendor it (ANSI escape sequences render properly), or
  - a basic `<pre>` fallback if xterm.js isn’t present.

## Run it
Serve the repo root (recommended; required for the shared TCAP parser code under `js/`):

```sh
python3 -m http.server 7878
```

Then visit `http://127.0.0.1:7878/web/`.

Note: Some browsers restrict ES modules when opened via `file://`. Serving `web/` over HTTP avoids that.

## Auto-discovery (Scan dropdowns)
If you run the server from the repo root, the viewer can scan the directory listing and auto-populate `.input` / `.output` files:

```sh
cd ..
python3 -m http.server 7878
```

Open `http://127.0.0.1:7878/web/` and click “Scan”.

## Vendor xterm.js (optional, recommended)
Run:

```sh
./fetch-xterm.sh
```

This downloads into:

- `web/vendor/xterm/xterm.js`
- `web/vendor/xterm/xterm.css`

These files are ignored by git via `web/.gitignore`.

If you prefer to do it manually, place these files yourself:

- `web/vendor/xterm/xterm.js`
- `web/vendor/xterm/xterm.css`

Once present, `index.html` will use them; otherwise it will fall back to loading xterm from a CDN.

## Notes
- Default “Tail” is 2 MiB to keep big logs snappy; set Tail=0 to load the whole file.
- “Chunk” + “Speed” control replay batching; the point is to avoid freezing the UI on large logs.

## Test report viewer
There’s also a tiny Catch2 JSON report viewer at `web/test-report/`:

1. Run `make test` (writes `debug/test-results.json`).
2. Serve the repo root: `python3 -m http.server 7878`
3. Open `http://127.0.0.1:7878/web/test-report/`
