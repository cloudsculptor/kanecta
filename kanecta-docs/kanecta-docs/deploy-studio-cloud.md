# Deploying Kanecta Studio to the cloud (with Keycloak)

Runbook for standing up the production-shaped stack defined in
[`deploy/docker-compose.yml`](../../deploy/docker-compose.yml): Kanecta Studio
(an nginx-served SPA) plus kanecta-api, protected by **your** Keycloak.
Kanecta never ships a Keycloak — every deployment brings its own; the
`kanecta-core/kanecta-auth-adapters/kanecta-keycloak` compose is a dev/test
stand-in only.

## Topology

```
browser ──HTTPS──▶ your TLS proxy ──▶ studio (nginx :80)
                                        ├── serves the SPA
                                        └── /api/ ──▶ kanecta-api :3000 (not host-exposed)
browser ──HTTPS──▶ Keycloak (yours, separate)
```

Same-origin by design: the SPA calls `/api` on its own origin, nginx proxies
to the api container, so kanecta-api needs **no CORS** and is never exposed
directly. The browser talks to Keycloak directly (login redirect + silent
SSO); kanecta-api talks to Keycloak only to fetch the realm JWKS for
verifying Bearer tokens.

The `/api/` proxy strips the prefix (`proxy_pass http://kanecta-api:3000/`
with a trailing slash), so kanecta-api serves its routes at `/` as normal.

## Prerequisites

- A host with Docker + the compose plugin, and a TLS-terminating reverse
  proxy (Caddy, nginx, Traefik…) in front of the studio port.
- A reachable Keycloak (26.x tested) with a realm you control.
- DNS for the studio host (e.g. `studio.example.com`) and for Keycloak.

## 1. Keycloak realm setup

In your realm, create a **public** client for Studio (confidential clients
don't work for a browser SPA — there is nowhere safe to hold the secret):

| Setting | Value |
|---|---|
| Client ID | e.g. `kanecta-studio` |
| Client type | OpenID Connect, public (no client authentication) |
| Standard flow | **on** (authorization code + PKCE — keycloak-js uses PKCE automatically) |
| Direct access grants | off (only the dev/test realm enables this, for API tests) |
| Valid redirect URIs | `https://studio.example.com/*` |
| Web origins | `https://studio.example.com` |

Silent SSO: Studio ships `silent-check-sso.html` in the SPA bundle and
keycloak-js loads it from the deployed origin, so the redirect-URI wildcard
above already covers it. Confirm after deploy that
`https://studio.example.com/silent-check-sso.html` returns the page.

**Audience mapper (strongly recommended).** Out of the box a Keycloak access
token carries **no `aud` claim for the API**, so kanecta-api can only verify
signature + issuer — any token minted by the realm (for any client) would
pass. Add a mapper so tokens name the API and set `KEYCLOAK_AUDIENCE`:

1. Client scopes → create scope `kanecta-api` (default type).
2. Add mapper → By configuration → **Audience**; included custom audience:
   `kanecta-api`; add to access token: on.
3. Add the scope to the Studio client's default client scopes.
4. Set `KEYCLOAK_AUDIENCE=kanecta-api` in `deploy/.env`.

Without the mapper, leave `KEYCLOAK_AUDIENCE` empty — enforcement is opt-in
precisely because a stock realm issues no such claim, and a non-empty value
would reject every login.

## 2. Configure and build

```sh
git clone git@github.com:cloudsculptor/kanecta.git && cd kanecta
cp deploy/example.env deploy/.env
# edit deploy/.env:
#   KEYCLOAK_URL=https://auth.example.com   # base URL, no /realms/... suffix
#   KEYCLOAK_REALM=my-realm
#   KEYCLOAK_CLIENT_ID=kanecta-studio
#   KEYCLOAK_AUDIENCE=kanecta-api           # if you added the mapper (do)
#   STUDIO_PORT=8080                        # host port your TLS proxy targets
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Notes:

- **Build from the monorepo root** (the compose file already does). Studio
  and kanecta-api depend on `@kanecta/*` npm workspaces that don't resolve
  from their own directories.
- `VITE_KEYCLOAK_*` values are **baked into the SPA at build time** (vite
  inlines `import.meta.env`), so each deployment builds its own studio image
  against its own Keycloak. Changing realm/URL later means rebuilding the
  studio image (`--build` again). Runtime injection (one generic image +
  entrypoint-written config.js) is a tracked follow-up.
- kanecta-api reads `KEYCLOAK_URL`/`KEYCLOAK_REALM` at **runtime** — those
  can be changed with just a container restart.
- The issuer the browser sees must equal the issuer kanecta-api expects:
  use the same public `KEYCLOAK_URL` for both (the compose file does). Split
  internal/external Keycloak URLs only work if Keycloak's hostname options
  pin the issuer to the public URL.

## 3. TLS in front

Point your reverse proxy at `127.0.0.1:${STUDIO_PORT}`, e.g. Caddy:

```
studio.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Keycloak must also be HTTPS — browsers block the redirect dance on mixed
content, and tokens must never cross the wire in clear.

## 4. Datastore

By default the compose file mounts the named volume `kanecta-data` at
`/data` and kanecta-api keeps a sqlite-fs working set there — zero-config,
single-node. Back it up like any volume (`docker run --rm -v
kanecta-data:/data -v $PWD:/out alpine tar czf /out/kanecta-data.tgz /data`).

For a cloud datastore (Postgres items + S3 files), mount a config dir whose
working set defines a composite `cloud` origin remote instead, and point
`KANECTA_DATASTORE` at it — see `kanecta-core/kanecta-lib` docs for working
set remotes.

## 5. Smoke test

After `up -d`, verify in order — each step isolates a different failure:

```sh
# 1. SPA served
curl -fsS http://127.0.0.1:8080/ | grep -o '<title>[^<]*'
# 2. silent SSO page present
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/silent-check-sso.html   # 200
# 3. API proxied AND locked
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/working-sets       # 401
# 4. real token accepted (borrow a token from the browser session,
#    devtools → network → any /api call → Authorization header)
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/api/working-sets       # 200
```

Then the real thing: open `https://studio.example.com`, log in via Keycloak,
confirm the tree loads and an item saves.

401 on step 4 usually means issuer mismatch (browser token minted at a
different Keycloak URL than kanecta-api verifies) or, if you set
`KEYCLOAK_AUDIENCE`, a missing audience mapper. `docker compose logs
kanecta-api` names which check failed.

## Local unauthenticated mode

Unchanged: run Studio outside this compose with `AUTH_DISABLED=true`
(kanecta-api) + `VITE_AUTH_DISABLED=true` (studio dev server / image build)
for single-user local use. The cloud deployment described here is the other
mode; the two never mix on one origin.

## Operational notes

- **Logs**: `docker compose -f deploy/docker-compose.yml logs -f kanecta-api`
- **Upgrade**: `git pull`, then `up -d --build` (SPA rebuild included).
- **RBAC**: `requireRole` middleware exists in kanecta-api but is applied to
  zero routes today — every authenticated realm user has full access. Scope
  the realm accordingly until per-route enforcement lands.
