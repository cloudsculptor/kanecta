# @kanecta/tiling-wm

Programmatically control window tiling on **Linux** by talking to an already-running
**i3** or **Sway** window manager over its documented IPC socket. Zero runtime
dependencies. Decoupled and standalone-testable from the CLI.

This does **not** implement a window manager and does **not** edit WM config files —
it uses the IPC protocol that i3/Sway expose specifically for external control (the
same mechanism status bars and automation tools use). Linux only; Windows/macOS are
out of scope.

## Why IPC (not a config file, not a custom WM)

- i3 and Sway are designed to be driven externally over a Unix-domain-socket IPC
  protocol — a first-class, documented use case, not a workaround.
- Config files are read at startup/reload, so they can't do live control. Real-time
  control goes through IPC.
- The wire format is simple enough to speak directly from Node (`net` + a small
  codec), so there's no C and no third-party dependency.

### On existing npm packages

The known Node i3-IPC packages (`i3ipc`, `i3`) are largely unmaintained and X11/i3-
oriented. Since i3 and Sway share one simple, stable wire format, this module
hand-rolls a ~90-line zero-dependency codec (`src/protocol.js`) that works for both
(including Wayland/Sway) and carries no stale-dependency risk. Swap in a maintained
package later if one emerges — `TilingClient` is the only integration point.

## Usage

```js
const { openTiling, createTilingService } = require('@kanecta/tiling-wm');

// Optional-capability style (never throws):
const svc = await createTilingService();
if (!svc.available) { console.log(svc.reason); return; }
const wm = svc.client;

// Or throw-if-missing:
// const wm = await openTiling();

const windows = await wm.listWindows();
// [{ id: <con_id>, name, appId, windowClass, workspace, output, focused, rect }, ...]

const target = windows.find((w) => w.focused);
await wm.moveWindowToWorkspace(target.id, '2: work');
await wm.split(target.id, 'vertical');
await wm.resize(target.id, { width: 50 });      // percentage points
await wm.focusWindow(target.id);

wm.close();
```

Windows are targeted by their **`con_id`** (the WM's stable container id from the
layout tree), so a specific window — e.g. the Electron app's own — can be placed into
a specific tile.

### Operations

| Method | i3/Sway command |
|---|---|
| `listWindows()` / `listWorkspaces()` / `listOutputs()` | `GET_TREE` / `GET_WORKSPACES` / `GET_OUTPUTS` |
| `moveWindowToWorkspace(conId, ws)` | `[con_id=…] move container to workspace …` |
| `moveWindowToOutput(conId, output)` | `[con_id=…] move container to output …` |
| `split(conId, 'horizontal'|'vertical')` | `[con_id=…] split …` |
| `resize(conId, { width, height })` | `[con_id=…] resize set width N ppt height N ppt` |
| `focusWindow(conId)` | `[con_id=…] focus` |
| `runCommand(cmd)` | any raw i3/Sway command (throws on `success:false`) |

## Detection

`detectTiling()` resolves the socket via, in order: `$SWAYSOCK`, `$I3SOCK`,
`i3 --get-socketpath`, `swaymsg --get-socketpath`. Returns `{ variant, socketPath }`
or `null`. `openTiling()` throws `TilingUnavailableError` (code `TILING_UNAVAILABLE`)
when nothing is found or off Linux; `createTilingService()` returns
`{ available, client, reason }` for graceful optional use.

## Wiring into a backend (Electron main / Node service)

Tiling is an **optional capability**. Open it once, then expose the operations over
the channel the renderer already uses. `dispatch()` gives a one-endpoint RPC proxy:

```js
const { createTilingService, dispatch } = require('@kanecta/tiling-wm');
const svc = await createTilingService();

// e.g. Electron main:
ipcMain.handle('tiling:call', (_e, { op, args }) => {
  if (!svc.available) throw new Error(svc.reason);
  return dispatch(svc.client, op, args); // op: 'listWindows' | 'moveWindowToWorkspace' | …
});

// or an HTTP route:
app.post('/tiling/:op', async (req, res) => {
  if (!svc.available) return res.status(501).json({ error: svc.reason });
  res.json(await dispatch(svc.client, req.params.op, req.body));
});
```

## Try it (standalone)

```sh
node examples/list-windows.js          # lists outputs / workspaces / windows
node examples/move-resize.js [conId]   # moves + resizes a window (focused by default)
npm test                               # unit tests (codec, detection, tree parsing)
```

The examples print a clear message and exit 0 if no i3/Sway is detected.
