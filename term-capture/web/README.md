# term-capture web viewer (offline PoC)

This is a tiny framework-free web “beachhead” for dogfooding term-capture logs without waiting for WebSockets.

## What it does
- Loads an existing `<prefix>.output` file via the browser File API (no server needed for file access).
- Replays bytes into:
  - **xterm.js** if you vendor it (ANSI escape sequences render properly), or
  - a basic `<pre>` fallback if xterm.js isn’t present.

## Run it
Open `web/index.html` in a browser, or serve the directory:

```sh
cd web
python3 -m http.server 8080
```

Then visit `http://127.0.0.1:8080/`.

## Vendor xterm.js (optional, recommended)
Place these files:

- `web/vendor/xterm/xterm.js`
- `web/vendor/xterm/xterm.css`

Once present, `index.html` will use them; otherwise it will fall back to loading xterm from a CDN.

## Notes
- Default “Tail” is 2 MiB to keep big logs snappy; set Tail=0 to load the whole file.
- “Chunk” + “Speed” control replay batching; the point is to avoid freezing the UI on large logs.
