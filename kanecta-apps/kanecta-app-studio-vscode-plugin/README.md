# Kanecta Studio (VS Code extension)

A thin wrapper that opens [Kanecta Studio](../kanecta-app-studio) inside a VS Code
webview tab. It does not bundle, build, or launch the API or Studio servers itself —
it just points a webview at a Studio instance you already have running.

## Prerequisites

- Studio (and the API it talks to) running on `localhost`, e.g. via `npm start` from
  the repo root, or `kanecta studio`.
- A pointer file at `~/.config/kanecta/config.json` (or `$XDG_CONFIG_HOME/kanecta/config.json`)
  with a `studioPort` field — the same file `npm start` creates/maintains. The extension
  reads this on each launch to find the port Studio is serving on:

  ```json
  {
    "studioPort": 9743,
    "apiPort": 9744
  }
  ```

  If the file is missing or unreadable, the extension shows an error message telling
  you to run `npm start` first.

## Use

Run the **Open Kanecta Studio** command from the Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`). Studio opens in a new editor tab at
`http://localhost:<studioPort>`.

## Running unpackaged (for development)

Open this folder in VS Code and press `F5` to launch an Extension Development Host
with the extension loaded.

## Packaging

From this directory (after `npm install` at the repo root):

```sh
npm run package
```

This produces a `.vsix` file in `dist/`, which can be installed with:

```sh
code --install-extension dist/kanecta-studio-vscode-<version>.vsix
```
