# kanecta-app-kanecta

The kanecta.io shell — a minimal Vite + React app with no fixed view set.
Where Kanecta Studio (`kanecta-app-studio`) is a pre-packaged, opinionated
app for software developers, `kanecta-app-kanecta` is the definitive,
general-purpose container: users compose in whichever Kanecta components
they want (file manager, trading view, etc.), nothing is forced.

This app is Phase 0 of the [kanecta.io launch plan](../../../../kanecta-private/infrastructure/kanecta-io-launch-plan.md)
(private repo). It shares the same Keycloak auth (`KeycloakProvider`) and
`@kanecta/api-client` wiring as Studio — see `src/auth/` and `src/api/`,
copied from `kanecta-app-studio`'s proven pattern rather than reinvented.

Currently the shell renders a title bar (app name + auth state) and an
empty content host region (`AppShell__content` in
`src/components/shell/AppShell.tsx`) with a TODO marking where Kanecta
components mount. There is no router and no view registry yet — those
arrive when kanecta.io actually needs to route between multiple mounted
components.

---

## Local development

```bash
# from the monorepo root
npm install

# start the dev server
npm run dev -w @kanecta/app-kanecta
```

By default this expects a Keycloak instance. For local development without
one, set `VITE_AUTH_DISABLED=true` (see `.env.example`) — no login screen,
no account UI, no `Authorization` header sent. Pair with the API's own
`AUTH_DISABLED=true`.

```bash
# run tests
npm test -w @kanecta/app-kanecta

# run Storybook
npm run storybook -w @kanecta/app-kanecta

# build for production
npm run build -w @kanecta/app-kanecta
```

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `KANECTA_API_URL` | `http://localhost:3001` | Dev-server proxy target for `/api` |
| `VITE_KEYCLOAK_URL` | — | Base URL of the Keycloak server |
| `VITE_KEYCLOAK_REALM` | — | Keycloak realm to authenticate against |
| `VITE_KEYCLOAK_CLIENT_ID` | — | Public client ID registered in that realm |
| `VITE_AUTH_DISABLED` | — | Set to `true` to skip Keycloak entirely for local dev. Never set in a real deployment. |

---

## Docker / deployment

This app has its own `Dockerfile` and `nginx.conf`, mirroring Studio's
pattern exactly: a static SPA built by vite, served by nginx, with `/api/`
proxied to the `kanecta-api` container.

**Build from the monorepo root** — this app depends on `@kanecta/*` npm
workspaces that don't resolve from this directory alone:

```bash
docker build -f kanecta-ui/kanecta-apps/kanecta-app-kanecta/Dockerfile \
  --build-arg VITE_KEYCLOAK_URL=https://auth.example.com \
  --build-arg VITE_KEYCLOAK_REALM=kanecta \
  --build-arg VITE_KEYCLOAK_CLIENT_ID=kanecta \
  -t kanecta-app .
```

`VITE_*` values are baked in at build time (vite inlines
`import.meta.env`), so each deployment builds its own image pointed at its
own Keycloak.

For the full compose topology (this app + `kanecta-api` + reverse proxy)
see [`deploy/docker-compose.yml`](../../../../deploy/docker-compose.yml)
(currently wired for Studio — a `kanecta-app-kanecta` service following the
same shape is part of the kanecta.io launch plan's later phases) and the
deploy runbooks under `kanecta-private/infrastructure/` and
`kanecta-private/runbooks/` (private repo).

---

## Style conventions

Same as Studio:
- SCSS only, co-located per component, one `.scss` file per component
- Modified BEM class names, block = the component's PascalCase filename
  (e.g. `.AppShell__content`)
- TypeScript only — no `.js`/`.jsx`/`.css`
