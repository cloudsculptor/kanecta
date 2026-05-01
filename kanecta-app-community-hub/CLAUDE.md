# Featherston Community Hub

A community information site for the town of Featherston, New Zealand. Built as an open-source project — all content and code are freely available to the community.

## Tech stack

- **React 19** with TypeScript
- **Vite** for bundling
- **React Router v7** for routing
- **MUI (Material UI) v9** for components
- **SCSS** (via sass) for styles — `App.scss` for component styles, `index.scss` for global variables and base styles
- **Keycloak** for authentication (`keycloak-js`) — self-hosted at `https://auth.featherston.co.nz`

## Architecture

No backend. This is a purely static SPA deployed on DigitalOcean App Platform from the `master` branch of the GitHub repo.

## Authentication & roles

Keycloak is self-hosted on the Remutaka Server at `https://auth.featherston.co.nz`, realm `featherston`, client `featherston-web`.

Roles are assigned as Keycloak realm roles. The auth layer is in `src/auth/`:
- `keycloak.ts` — Keycloak singleton instance
- `KeycloakProvider.tsx` — React context, initialises with `check-sso` so session is restored silently
- `useUserRole.ts` — maps Keycloak realm roles to the app's role type

Four roles, defined in `src/auth/useUserRole.ts`:

| Role | Description |
|------|-------------|
| `PUBLIC` | Not logged in |
| `LOCAL` | Logged in (default for authenticated users with no specific role) |
| `RESILIENCE` | Has the `resilience` Keycloak realm role |
| `TEAM` | Has the `team` Keycloak realm role |

Use `useUserRole()` anywhere in the app to get the current role.

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
- `src/pages/Home.tsx` — role-based tile grid (different tiles for PUBLIC vs logged-in)
- `src/pages/Governance.tsx` — governance structure with role cards
- `src/App.tsx` — route definitions

## Commit style

Conventional commits with a rich body. No Claude attribution in commit messages.

Example:
```
feat(home): add photos to Events and Transport tiles

- Short bullet explaining what changed and why
- Another bullet
```

## Deployment

- Platform: DigitalOcean App Platform
- Branch: `master` (auto-deploys on push)
- Environment variables required at build time:
  - `VITE_KEYCLOAK_URL` — `https://auth.featherston.co.nz`
  - `VITE_KEYCLOAK_REALM` — `featherston`
  - `VITE_KEYCLOAK_CLIENT_ID` — `featherston-web`
- Production URL: https://featherston.co.nz
