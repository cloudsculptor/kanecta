# Kanecta Studio (macOS package)

A thin Electron wrapper around [Kanecta Studio](../kanecta-app-studio), packaged as a
macOS app. It opens a single window pointed at a running Studio instance — it does not
bundle or launch the API or UI servers itself.

This is the macOS counterpart to [kanecta-app-studio-debian](../kanecta-app-studio-debian)
and [kanecta-app-studio-windows](../kanecta-app-studio-windows); the wrapper code
(`main.cjs`) is identical, only the packaging target differs.

## Prerequisites

- A Kanecta Studio instance you can reach over HTTP (e.g. one started locally with
  `kanecta studio`, or a remotely hosted deployment).
- A `"REMOTE"` workspace configured in `~/.config/kanecta/config.json` pointing at it:

  ```json
  {
    "workspaces": {
      "remote": {
        "mode": "REMOTE",
        "remote": {
          "url": "http://localhost:9743",
          "apiUrl": "http://localhost:9744"
        }
      }
    }
  }
  ```

  The app looks for the first workspace with `mode: "REMOTE"` (checking the `default`
  workspace first) and opens a window at its `remote.url`. If none is found, it shows an
  error dialog explaining how to add one.

## Install

Unzip `Kanecta Studio-<version>-mac.zip` and drag **Kanecta Studio.app** into
`/Applications`.

### Gatekeeper warning (unsigned build)

This build is **not code-signed or notarized** (it's cross-built on Linux, where Apple's
signing tools aren't available). macOS will refuse to open it normally ("Kanecta Studio
is damaged and can't be opened" / "unidentified developer"). To run it anyway:

```sh
xattr -cr "/Applications/Kanecta Studio.app"
```

then open it as usual (or right-click → **Open** → **Open** on the warning dialog).

## Building the package

DMG creation requires macOS-only tools (`sips`, `hdiutil`), so this package only builds a
`.zip` of the `.app` bundle — that works fine when cross-building on Linux. From this
directory (after `npm install` at the repo root):

```sh
npm run dist
```

This produces `dist/Kanecta Studio-<version>-mac.zip`. Code signing is skipped
automatically (`identity: null` in the `build.mac` config) since it's only supported on
macOS.

## Running unpackaged (for development)

```sh
npm start
```

This runs the wrapper directly via Electron, using the same config-file lookup as the
packaged app.
