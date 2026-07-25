# Community Hub e2e tests

End-to-end Playwright tests run against a **deployed** environment — nonprod
(`https://test.featherston.co.nz`) by default. They exercise the real stack:
browser → nginx → community-hub-api → kanecta-api → Postgres/Spaces.

**Never point these at prod.** Several suites write data (discussions posts,
uploads, notices) and clean up after themselves, but only nonprod is
disposable.

## Running

```bash
npm install
npx playwright install chromium
E2E_USERNAME=<tester account email> E2E_PASSWORD=<password> npm test
```

Environment variables:

| Var | Default | Meaning |
|-----|---------|---------|
| `E2E_BASE_URL` | `https://test.featherston.co.nz` | Target environment |
| `E2E_USERNAME` | — | Tester realm account (needs `tester`, `team`, `moderator` roles) |
| `E2E_PASSWORD` | — | Its password (from the password store; never commit it) |

The `setup` project logs in once via Keycloak and stores the session in
`.auth/state.json` (gitignored); the `authenticated` project reuses it.

## Suites

- `site-editable-pages.spec.ts` — regression guard for the 0629-merge loss:
  each site-editable page must consult `/api/pages/public/<slug>` and show
  moderators the "Edit this page" link; anonymous visitors must not see it.
