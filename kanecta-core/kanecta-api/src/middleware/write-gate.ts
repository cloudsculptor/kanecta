import type { Request, Response, NextFunction } from 'express';

// Coarse read/write capability gate for kanecta-api.
//
// kanecta-api is a generic component with no notion of any application's roles —
// it knows only the universal capabilities READ and WRITE. Reads are open to any
// authenticated caller; mutations require a write capability carried in the
// token's realm roles (`admin` implies write). The write-capability role name
// defaults to `write` and can be overridden per deployment with
// KANECTA_WRITE_ROLE — the name is deployment config, never baked into the code,
// so the component stays app-agnostic.
//
// It is a NO-OP whenever AUTH_DISABLED is set. That mode injects a local-dev
// admin and is how (a) Studio runs unauthenticated locally and (b) a same-host
// backend (e.g. a community-hub API) calls kanecta-api tokenlessly. Neither must
// ever be broken by this gate — hence the early return before any role check.
//
// Classification is coarse and by HTTP method: GET/HEAD/OPTIONS are reads, and
// the read-only POST endpoints (GraphQL is a query-only interface today) are
// exempt; everything else is a write. This deliberately treats state-changing
// POSTs (branch switch, activate, per-user UI state) as writes — a read-only
// caller cannot change anything. Refine to per-item authorization via the G4
// grant engine (authz/index.ts) when finer control is needed.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// POST paths that only READ (no state change) and so are exempt from the gate.
// NOTE: /graphql has no mutations in the schema today; revisit if any are added.
const READ_ONLY_POST_PATHS = new Set(['/graphql']);

export function requireWrite(req: Request, res: Response, next: NextFunction) {
  // Local/unauth and trusted same-host backends run AUTH_DISABLED — never gate them.
  if (process.env.AUTH_DISABLED === 'true') return next();

  // Reads are open to any authenticated caller.
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (READ_ONLY_POST_PATHS.has(req.path)) return next();

  // Writes require the write capability (admin implies write).
  const writeRole = process.env.KANECTA_WRITE_ROLE || 'write';
  const roles = req.user?.roles ?? [];
  if (roles.includes(writeRole) || roles.includes('admin')) return next();

  return res.status(403).json({ error: 'Write access required' });
}
