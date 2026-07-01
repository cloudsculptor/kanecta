---
"@kanecta/component-web-tiling-view": minor
"@kanecta/studio": minor
---

Add a **Frames** view — a tiling window manager of web panes.

A new Studio view (`@kanecta/component-web-tiling-view`) that tiles multiple web
panes in a split/resize layout (mirroring the internal Layouts view), where each
pane is a browser: a URL bar with back/forward/reload/home, and an Electron
`<webview>` that can load Kanecta itself *or* any external website (Jira, docs,
etc.). Panes split horizontally/vertically, resize by dragging, and close.

It does **not** replace the internal Layouts view — it's the more powerful
option for framing Kanecta alongside other web apps. It is **Electron-only**
(the `<webview>` needs `webviewTag`, enabled in the Debian wrapper); in a plain
browser the tiling UI renders but panes stay blank.
