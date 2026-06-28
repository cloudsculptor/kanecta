# Kanecta Studio (Debian package)

A thin Electron wrapper around [Kanecta Studio](../kanecta-app-studio), packaged as a
`.deb` for Debian/Ubuntu. It opens a single window pointed at a running Studio instance —
it does not bundle or launch the API or UI servers itself.

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

## Running unpackaged (for development)

```sh
npm start
```

This runs the wrapper directly via Electron, using the same `~/.config/kanecta/config.json`
lookup as the packaged app.
