# Running Kanecta Studio locally from source

## Prerequisites

- Node.js 18 or later
- npm 8 or later (comes with Node 18)

## First-time setup

Clone the repo and install all dependencies in one step from the root:

    git clone git@github.com:cloudsculptor/kanecta.git
    cd kanecta
    npm install

This uses npm workspaces — a single install wires up all packages.

## Start the dev servers

From the repo root:

    npm run dev

This starts two processes together:

  [api]    http://localhost:3001   — REST API (auto-restarts on file changes)
  [studio] http://localhost:5173   — Vite dev server (hot-module reload)

Open http://localhost:5173 in your browser.

The studio proxies /api/* to the API server automatically — no CORS config needed.

To use a different API URL set KANECTA_API_URL before running:

    KANECTA_API_URL=http://my-server:3001 npm run dev

## Initialise a datastore (first run only)

The API needs a datastore to connect to. Set the path with an environment variable:

    KANECTA_DATASTORE=~/.kanecta npm run dev

Or create one with the CLI first:

    cd kanecta-cli
    npm run cli init --owner you@example.com

This creates a datastore at ~/.kanecta by default.

## CLI (optional)

    cd kanecta-cli
    npm run cli -- --help

## Running servers individually

    npm run dev -w kanecta-api              # API only (with file watching)
    npm run dev -w kanecta-apps/kanecta-app-studio   # Studio only
