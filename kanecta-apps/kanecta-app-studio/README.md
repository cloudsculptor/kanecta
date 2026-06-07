# Kanecta Studio

A knowledge management interface for the Kanecta datastore. Built for the kind of people who live in Notion, Obsidian, Airtable, WorkFlowy, or Microsoft Access — and for developers working closely with AI.

---

## Launch

Kanecta Studio is launched through the `kanecta` CLI:

```bash
kanecta studio
```

This command:
1. Starts the `@kanecta/api` server pointing at your configured datastore
2. Starts the Studio web app on `localhost`
3. Opens the URL in your default browser

---

## Who it's for

**Developers working with AI**
You're using Claude or similar tools to populate and manage knowledge in a Kanecta datastore. You need to review, refine, navigate, and extend what the AI has built — across multiple sessions running simultaneously.

**Knowledge workers and power users**
You're the kind of person who has strong opinions about Notion, Obsidian, Airtable, WorkFlowy, or similar tools. You want a structured, fast, capable interface for your information — with views and editing modes that match how you think.

---

## Features

### Shell
- Four-sided chrome: top bar, expandable left sidebar, right context panel, bottom status bar
- Left sidebar collapses to icons, expands to full labels
- Centre workspace splits into multiple panels simultaneously — any view in any panel

### Editing
- Block-based rich text editor for long-form items
- Slash commands (`/`) to insert any block type
- `@mention` items to create inline links (`[[uuid]]` under the hood)
- Drag and drop block reordering
- Inline databases embedded within documents

### Tree view
- Outline editor: click to edit in place
- Keyboard-driven: Enter for new sibling, Tab / Shift-Tab to indent / outdent
- Drag to reorder
- Zoom into any node; breadcrumb updates as you navigate
- Confidence shown as a subtle colour per bullet

### Database views
Each view operates on items filtered by type. All views share filters, sorts, group-by, and named saved filter presets.

| View | Description |
|------|-------------|
| Table | Rows and columns, inline cell editing |
| Board | Kanban columns, groupable by confidence, tag, or any property |
| Gallery | Card grid with value, type, tags, and confidence badge |
| List | Dense flat list with inline property chips |
| Calendar | Items placed by created or modified date |
| Timeline | Horizontal bar chart by date range *(planned)* |

### Graph view
- Force-directed node graph
- Nodes are items; edges are `[[uuid]]` backlinks and typed relationships
- Colour-coded by type, confidence, and origin workspace
- Toggle full graph or local neighbourhood of the focused item

### Knowledge features
- **Templates** — save any subtree as a template; instantiate to create a new branch
- **Relations and rollups** — relationships surfaced as database columns with aggregate counts
- **Linked views** — the same type as a table in one panel and a board in another simultaneously
- **Breadcrumbs** — always know where you are, clickable to jump
- **Unlinked mentions** — items whose text matches other items but isn't linked yet, surfaced as suggestions

### AI collaboration
- **Review queue** — recently created items sorted by low confidence, for triage
- **Review conveyor** — keyboard-driven triage mode: approve, annotate, skip, delete one item at a time
- **Confidence heatmap** — graph nodes glow from red (experimental) to green (locked)
- **Annotation threads** — threaded comments anchored to any item
- **History timeline** — per-item change log showing all create / update / delete snapshots
- **Quick capture** — floating input to create an item without losing your place

### Mission Control — multiple Claude instances
For developers running multiple Claude CLI sessions across different folders simultaneously:

- **Workspace registry** — configure multiple named API endpoints, one per Claude workspace
- **Flight deck panel** — one column per active workspace with traffic-light status, item counts, and a sparkline of recent activity
- **Live activity feed** — unified chronological stream of all items created or modified across all workspaces, colour-coded by origin
- **Per-instance review queues** — triage items from each Claude session independently
- **Conflict detection** — flags when two workspaces create similar items or both modify the same subtree
- **Digest view** — summary of what all instances did since you last looked: items created, themes, conflicts, review backlog
- **Pause indicator** — soft signal when unreviewed backlog exceeds a threshold you set
- **Attribution** — every item shows which workspace created it, throughout all views

### Full API coverage
Every Kanecta datastore operation is reachable from the UI: items CRUD, aliases, annotations with threaded replies, relationships, backlinks, tags, history, and index rebuild via settings.

---

## Package

```
@kanecta/studio
```

Published to npm. Installed as an app option of `kanecta` (via `kanecta-node`).

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (requires KANECTA_API_URL, or use: kanecta studio)
npm run dev

# Run tests
npm test

# Run Storybook component explorer
npm run storybook

# Build for production
npm run build
```

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `KANECTA_API_URL` | `http://localhost:3000` | Primary API endpoint |
| `VITE_KEYCLOAK_URL` | — | Base URL of the Keycloak server (e.g. `https://keycloak.example.com`) |
| `VITE_KEYCLOAK_REALM` | — | Keycloak realm to authenticate against |
| `VITE_KEYCLOAK_CLIENT_ID` | — | Public client ID registered in that realm |
| `VITE_AUTH_DISABLED` | — | Set to `true` to skip Keycloak entirely for local dev — no login screen, no avatar menu, no `Authorization` header sent. Pairs with the API's `AUTH_DISABLED=true`. Never set in a real deployment. |

Additional workspaces are configured inside the app's settings panel.

### Authentication

Studio authenticates against a Keycloak instance supplied by whoever deploys
it — there's no built-in default realm. `VITE_KEYCLOAK_URL`,
`VITE_KEYCLOAK_REALM`, and `VITE_KEYCLOAK_CLIENT_ID` must all be set (the
client should be a public client with PKCE enabled). Once signed in, an
avatar and account menu appear in the top-right of the top bar showing the
user's name, email, and primary role, with a sign-out action.

For local development without a Keycloak instance, set `VITE_AUTH_DISABLED=true`
(and the API's `AUTH_DISABLED=true`) to run unauthenticated — the avatar/login
UI is hidden entirely and no `Authorization` header is sent.

To develop and test against a real Keycloak instance, the `kanecta-keycloak`
workspace package stands up Keycloak + Postgres + MinIO via Docker Compose
with a pre-seeded test realm:

```bash
npm run docker:up -w kanecta-keycloak
```

---

## Style conventions

- Material UI for all components
- SASS for component-level styles, one `.scss` file per component
- BEM class names prefixed with the component name: `.TreeView-node-label`, `.BoardView-card-header`, etc.
- No global styles except CSS custom properties on `:root`
