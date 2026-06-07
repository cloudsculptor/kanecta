# Kanecta Studio (Windows package)

A thin Electron wrapper around [Kanecta Studio](../kanecta-app-studio), packaged as a
Windows installer (NSIS `.exe`). It opens a single window pointed at a running Studio
instance — it does not bundle or launch the API or UI servers itself.

This is the Windows counterpart to [kanecta-app-studio-debian](../kanecta-app-studio-debian);
the wrapper code (`main.cjs`) is identical, only the packaging target differs.

## Prerequisites

- A Kanecta Studio instance you can reach over HTTP (e.g. one started locally with
  `kanecta studio`, or a remotely hosted deployment).
- A `"REMOTE"` workspace configured in `%USERPROFILE%\.config\kanecta\config.json`
  (i.e. `C:\Users\<you>\.config\kanecta\config.json`) pointing at it:

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

Run `Kanecta Studio Setup <version>.exe` and follow the installer prompts (you can choose
the install directory and whether to create Desktop/Start Menu shortcuts). Once installed,
launch **Kanecta Studio** from the Start Menu or its shortcut.

## Uninstall

Use **Add or Remove Programs** in Windows Settings, or run the generated uninstaller from
the install directory.

## Building the package

This must currently be built on Linux with [Wine](https://www.winehq.org/) installed
(electron-builder shells out to Windows tools like `makensis.exe` via Wine to produce the
NSIS installer):

```sh
sudo apt install wine
```

Then, from this directory (after `npm install` at the repo root):

```sh
npm run dist
```

This produces `dist/Kanecta Studio Setup <version>.exe`.

## Running unpackaged (for development)

```sh
npm start
```

This runs the wrapper directly via Electron, using the same config-file lookup as the
packaged app.
