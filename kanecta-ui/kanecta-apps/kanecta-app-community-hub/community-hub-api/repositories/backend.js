// The DATA_BACKEND toggle (Owner decision: one whole-app switch at startup, not
// per-domain). `pg` (default) keeps the raw SQL against featherston Postgres;
// `kanecta` routes reads/writes through kanecta-api over HTTP against the Kanecta
// four-table datastore. Each domain repository delegates its implemented methods
// to repositories/kanecta/<domain>.js when this is true; everything else stays on
// the pg path, so the switch can land domain-by-domain while the app still boots.
export const USE_KANECTA = process.env.DATA_BACKEND === "kanecta";
