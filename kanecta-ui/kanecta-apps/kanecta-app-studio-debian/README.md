# Kanecta Studio (Debian package)

A thin Electron wrapper around [Kanecta Studio](../kanecta-app-studio), packaged as a
`.deb` for Debian/Ubuntu. It opens a single window pointed at a running Studio instance —
it does not bundle or launch the API or UI servers itself.

## Which Studio does it load?

`main.cjs` resolves the Studio web URL in this priority order:

1. **`KANECTA_STUDIO_URL`** env var — the dev override (used by `npm run dev`).
2. **`studioUrl`** in `~/.config/kanecta/config.json` — an explicit URL.
3. A legacy `mode: "REMOTE"` workspace's `remote.url` (back-compat).
4. **`http://localhost:9743`** — the zero-config dev default.

The window retries the load for up to 60s, so it can be launched before the dev
server is up. **`Ctrl+R`** reloads the window; **`F12`** toggles DevTools.

## Install

```sh
sudo dpkg -i dist/kanecta-studio-debian_<version>_amd64.deb
```

If `dpkg` reports missing dependencies, resolve them with:

```sh
sudo apt-get install -f
```

Once installed, launch **Kanecta Studio** from your application menu, or run:

```sh
kanecta-studio
```

## Uninstall

```sh
sudo dpkg -r kanecta-studio-debian
```

## Building the package

From this directory (after `npm install` at the repo root):

```sh
npm run dist
```

This produces `dist/kanecta-studio-debian_<version>_amd64.deb`.

## Local development (use the desktop app instead of the browser)

The dev flow mirrors the browser one (`git pull origin master` → `npm start`), just
launching the desktop window instead of opening a browser tab. It is **decoupled** —
`npm run dev` does not start the servers, it only opens the window.

**Terminal 1 — repo root** (starts the API on `:9744` + Studio on `:9743`, exactly as
you do today for the browser):

```sh
git pull origin master
npm start
```

**Terminal 2 — this directory** (opens the desktop window at `http://localhost:9743`):

```sh
npm run dev
```

Getting updates is the same `git pull origin master` you already run: the Studio dev
server hot-reloads, so the desktop window shows the latest immediately. The Electron
wrapper itself (`main.cjs`) updates on the next launch. `npm run update` is a shortcut
for `git -C <repo root> pull origin master`.

`npm start` here (no env var) runs the wrapper against whatever the config/URL resolution
above selects — the same behaviour as the packaged app.
