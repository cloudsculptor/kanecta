# Featherston Community Hub

A community information site for the town of Featherston, New Zealand. Built as an open-source project — all content and code are freely available to the community.

## Tech stack

- **React 19** with TypeScript
- **Vite** for bundling
- **React Router v7** for routing
- **MUI (Material UI) v9** for components
- **SCSS** (via sass) for styles — `App.scss` for component styles, `index.scss` for global variables and base styles
- **Keycloak** for authentication (`keycloak-js`) — self-hosted at `https://auth.featherston.co.nz`
- **Socket.io** for real-time discussions

## Architecture

- **Frontend** — static SPA deployed on DigitalOcean App Platform from `master`
- **Backend** — Express + Socket.io API on the Remutaka Server (port 3000, managed by pm2), proxied by nginx
- **Database** — Remutaka managed PostgreSQL (DigitalOcean)

## Authentication & roles

Keycloak is self-hosted on the Remutaka Server at `https://auth.featherston.co.nz`, realm `featherston`, client `featherston-web`.

Roles are assigned as Keycloak realm roles. The auth layer is in `src/auth/`:
- `keycloak.ts` — Keycloak singleton instance
- `KeycloakProvider.tsx` — React context, initialises with `check-sso` so session is restored silently
- `useUserRole.ts` — maps Keycloak realm roles to the app's role type

| Role | Keycloak role | Description |
|------|--------------|-------------|
| `PUBLIC` | — | Not logged in |
| `LOCAL` | — | Logged in, no specific role |
| `RESILIENCE` | `resilience` | Resilience workstream access |
| `TEAM` | `team` | Full discussions access |
| `MODERATOR` | `moderator` | Discussions + can delete anyone's messages |

Use `useUserRole()` anywhere in the app to get the current role.

## Discussions feature

Slack-style real-time discussions at `/discussions`. Requires `team` or `moderator` role.

### Frontend components (`src/components/discussions/`)
- `MessageItem` — message with hover actions, inline edit, reactions, reply count, mention rendering
- `MentionInput` — textarea with `@mention` autocomplete (replaces MessageInput everywhere)
- `ReplyPanel` — Slack-style thread side panel (original message + replies + input)
- `EmojiPicker` — emoji-mart vanilla web component (React 19 compatible)
- `CreateThreadModal` — MUI dialog for creating threads

### API client (`src/api/discussions.ts`)
Typed wrappers for all backend endpoints. Attaches Keycloak Bearer token automatically.

### Socket.io hook (`src/hooks/useSocket.ts`)
- `useSocket()` — returns the singleton Socket.io connection
- `useThreadSocket(threadId, handlers)` — joins a thread room and wires event handlers
- `useRepliesSocket(messageId, handlers)` — joins a replies room

### Backend (`featherston-api/`)
- `server.js` — Express + Socket.io, attaches `req.io` for route → socket emission
- `db.js` — pg connection pool (env: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`)
- `middleware/auth.js` — Keycloak JWT validation (`requireAuth`, `requireRole`)
- `routes/discussions.js` — all REST endpoints (threads, messages, replies, reactions, users)
- `socket/discussions.js` — Socket.io auth + room management
- `ecosystem.config.cjs` — pm2 config with env vars (on Remutaka Server only, not in repo)

### Database tables
- `discussions_threads` — thread metadata
- `discussions_messages` — messages and replies (`parent_message_id IS NULL` = top-level)
- `discussions_reactions` — emoji reactions (composite PK: message_id + user_id + emoji)

### @mentions
Encoded in message content as `@[Name](userId)`. `parseMentions()` in `MentionInput.tsx` splits content for rendering. Autocomplete shows users derived from message authors in the DB.

### Tests
- Backend: `npm test` in `featherston-api/` — Jest + Supertest, 28 tests, all passing
- Frontend: Storybook — `npm run storybook` in `featherston-client-web/`

## Theming

CSS custom properties defined in `index.scss`:
- `--accent` / `--accent-bg` / `--accent-border` — forest green (`#3a7d44` light, `#5aad68` dark)
- `--text`, `--text-h`, `--bg`, `--border` — standard text/surface tokens
- Light and dark mode supported via `prefers-color-scheme`

Header gradient: `#0d2b12 → #1a4d22 → #2d6a35`

## Key files

- `src/auth/useUserRole.ts` — role hook
- `src/components/Header.tsx` — site header with auth-aware login/logout
- `src/components/PageLayout.tsx` — standard page wrapper (breadcrumb, coming-soon banner)
- `src/pages/Home.tsx` — role-based tile grid
- `src/pages/Discussions.tsx` — main discussions page
- `src/App.tsx` — route definitions

## Commit style

Conventional commits with a rich body. No Claude attribution in commit messages.

```
feat(home): add photos to Events and Transport tiles

- Short bullet explaining what changed and why
- Another bullet
```

## Deployment

### Frontend
- Platform: DigitalOcean App Platform, auto-deploys on push to `master`
- Build env vars (set as GitHub secrets):
  - `VITE_KEYCLOAK_URL` — `https://auth.featherston.co.nz`
  - `VITE_KEYCLOAK_REALM` — `featherston`
  - `VITE_KEYCLOAK_CLIENT_ID` — `featherston-web`
- `VITE_API_URL` — leave unset in production (connects to same origin via nginx proxy)
- Production URL: https://featherston.co.nz

### Backend
- Server: Remutaka Server (`209.38.25.134`), managed by pm2 via `ecosystem.config.cjs`
- nginx proxies `/api/` and `/socket.io/` to port 3000 with WebSocket upgrade headers
- Deploy: `git push master` triggers GitHub Actions rsync + `pm2 start ecosystem.config.cjs --update-env`
- Logs: `ssh remutaka "pm2 logs featherston-api"`
