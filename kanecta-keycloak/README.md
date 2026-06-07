# kanecta-keycloak

Local Keycloak + Postgres + MinIO stack for developing and testing Kanecta's
auth integration. This is **dev/test infrastructure only** — it stands in for
the Keycloak instance that a real client deployment would supply themselves.

## Usage

```bash
npm run docker:up -w kanecta-keycloak    # bring the stack up, wait for it to be ready
npm run docker:logs -w kanecta-keycloak  # tail logs
npm run docker:down -w kanecta-keycloak  # tear it down
```

First boot is slow — Keycloak has to import the realm and can take 30-60s.
`docker:up` polls the realm's OIDC discovery endpoint and MinIO's health
endpoint until both are ready.

## Services

| Service | Purpose | Port |
|---------|---------|------|
| `keycloak` | OIDC identity provider | `45980` (`http://localhost:45980`) |
| `keycloak-db` | Postgres backing Keycloak itself | `45981` |
| `minio` | S3-compatible storage, for exercising cloud-mode datastores alongside auth | `45990` (API), `45991` (console) |

These ports are deliberately distinct from the personal `kanecta-postgres`
(`45432`) and MinIO (`45900`) instances configured in `~/.config/kanecta/config.json`,
so this stack can run alongside them without colliding.

## Test realm

The realm `kanecta-test` is imported automatically on first boot from
`realm-export.json`:

- **Client**: `kanecta-studio-test` — public client, PKCE-friendly, with
  direct access grants enabled so tests can fetch real tokens via the
  password grant
- **Realm roles**: `admin`, `member`
- **Seeded users**:
  | Username | Password | Role |
  |----------|----------|------|
  | `kanecta-admin` | `kanecta-admin-password` | `admin` |
  | `kanecta-member` | `kanecta-member-password` | `member` |

To point `kanecta-api` or `kanecta-app-studio` at this stack:

```bash
KEYCLOAK_URL=http://localhost:45980 KEYCLOAK_REALM=kanecta-test npm test -w kanecta-api

VITE_KEYCLOAK_URL=http://localhost:45980
VITE_KEYCLOAK_REALM=kanecta-test
VITE_KEYCLOAK_CLIENT_ID=kanecta-studio-test
```

`kanecta-api/tests/auth.test.js` fetches real tokens from this realm and
skips itself with a warning if the stack isn't reachable.
