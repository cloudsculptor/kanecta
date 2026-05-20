# Running Kanecta Studio locally from source

## Prerequisites

- Node.js 18 or later

## Setup

    git clone git@github.com:cloudsculptor/kanecta.git
    cd kanecta
    npm install
    npm run dev

Open http://localhost:5173

The API runs on port 3001 and the studio proxies to it automatically.

## First run — initialise a datastore

The API looks for a datastore at `~/.kanecta` by default. Create one before
starting the dev servers:

    cd kanecta-cli
    npm run cli init --owner you@example.com

Or point to an existing datastore with an environment variable:

    KANECTA_DATASTORE=/path/to/your/datastore npm run dev

## Running servers individually

    npm run dev -w kanecta-api                       # API only (auto-restarts on save)
    npm run dev -w kanecta-apps/kanecta-app-studio   # Studio only
