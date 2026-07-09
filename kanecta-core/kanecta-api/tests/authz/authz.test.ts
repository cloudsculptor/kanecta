// Tests for the G4 authz decision engine. Pure — an in-memory AuthzSource models
// the community-hub role→grant scenario (plans/community-hub-authz-mapping.md).

import { describe, it, expect } from 'vitest';
import {
  decide,
  can,
  satisfies,
  principalsFromToken,
  filterReadable,
  emailVerified,
} from '../../src/authz/index.ts';
import { MemoryAuthzSource } from './memory-authz-source.ts';

// ── The community-hub containment + grant model ──────────────────────────────
// root ─ Discussions (team read/write cascade, moderator write/admin cascade)
//      │   └─ Thread T ─ Message M (owner u-alice)
//      ├─ Finances  (treasurer write cascade; a public-read transaction)
//      └─ role/admin has admin over root (cascade) = superuser
const ROOT = '00000000-0000-0000-0000-000000000000';

function communityHub(): MemoryAuthzSource {
  const s = new MemoryAuthzSource();
  s.item({ id: ROOT, parentId: ROOT });
  s.grant(ROOT, { principal: 'role/admin', permissions: ['admin'], cascade: true });

  s.item({ id: 'DISC', parentId: ROOT, visibility: 'private' });
  s.grant('DISC',
    { principal: 'role/team', permissions: ['read', 'write'], cascade: true },
    { principal: 'role/moderator', permissions: ['write', 'admin'], cascade: true },
  );
  s.item({ id: 'T', parentId: 'DISC', visibility: 'private' });
  s.item({ id: 'M', parentId: 'T', visibility: 'private', owner: 'u-alice' });

  s.item({ id: 'FIN', parentId: ROOT, visibility: 'private' });
  s.grant('FIN', { principal: 'role/treasurer', permissions: ['write'], cascade: true });
  s.item({ id: 'TX1', parentId: 'FIN', visibility: 'public' }); // public finance read

  return s;
}

const team = ['u-bob', 'role/team'];
const moderator = ['u-mod', 'role/moderator'];
const treasurer = ['u-tina', 'role/treasurer'];
const admin = ['u-root', 'role/admin'];
const outsider = ['u-carol'];
const anonymous: string[] = [];

describe('permission implication', () => {
  it('admin ⊇ write ⊇ read; subscribe ⊇ read', () => {
    expect(satisfies(['admin'], 'read')).toBe(true);
    expect(satisfies(['admin'], 'write')).toBe(true);
    expect(satisfies(['write'], 'read')).toBe(true);
    expect(satisfies(['write'], 'admin')).toBe(false);
    expect(satisfies(['subscribe'], 'read')).toBe(true);
    expect(satisfies(['read'], 'write')).toBe(false);
  });
});

describe('principalsFromToken', () => {
  it('expands realm roles into role/ namespace principals', () => {
    expect(principalsFromToken({ sub: 'u-bob', roles: ['team', 'moderator'] }).sort()).toEqual(
      ['role/moderator', 'role/team', 'u-bob'],
    );
  });
});

describe('decide — community-hub scenario', () => {
  const s = communityHub();

  it('team member reads + writes a message via a cascading container grant', async () => {
    expect(await can(s, team, 'M', 'read')).toBe(true);
    expect(await can(s, team, 'M', 'write')).toBe(true);
  });

  it('team member cannot admin (manage grants)', async () => {
    expect(await can(s, team, 'M', 'admin')).toBe(false);
  });

  it('moderator can write and admin any message', async () => {
    expect(await can(s, moderator, 'M', 'write')).toBe(true);
    expect(await can(s, moderator, 'M', 'admin')).toBe(true);
  });

  it('outsider cannot read a private message', async () => {
    const d = await decide(s, outsider, 'M', 'read');
    expect(d).toEqual({ allow: false, reason: 'no-matching-grant' });
  });

  it('owner writes their own message without any role', async () => {
    expect(await can(s, ['u-alice'], 'M', 'write')).toBe(true);
    expect(await can(s, ['u-alice'], 'M', 'read')).toBe(true);
    // ...but owner does not get admin implicitly.
    expect(await can(s, ['u-alice'], 'M', 'admin')).toBe(false);
  });

  it('admin role is a superuser via a cascading grant on root', async () => {
    expect(await can(s, admin, 'M', 'admin')).toBe(true);
    expect(await can(s, admin, 'TX1', 'write')).toBe(true);
  });

  it('treasurer writes finances; team does not', async () => {
    expect(await can(s, treasurer, 'TX1', 'write')).toBe(true);
    expect(await can(s, team, 'TX1', 'write')).toBe(false);
  });

  it('anonymous reads a public item, not a private one', async () => {
    expect(await can(s, anonymous, 'TX1', 'read')).toBe(true);
    expect((await decide(s, anonymous, 'TX1', 'read')).reason).toBe('public');
    expect(await can(s, anonymous, 'M', 'read')).toBe(false);
  });
});

describe('cascade semantics', () => {
  it('a non-cascading grant on a container does NOT reach its children', async () => {
    const s = new MemoryAuthzSource();
    s.item({ id: 'C', parentId: '00000000-0000-0000-0000-000000000000' });
    s.grant('C', { principal: 'role/team', permissions: ['read'], cascade: false });
    s.item({ id: 'child', parentId: 'C' });
    expect(await can(s, ['role/team'], 'C', 'read')).toBe(true); // direct grant on C
    expect(await can(s, ['role/team'], 'child', 'read')).toBe(false); // does not cascade
  });

  it('a direct grant on the target applies even without cascade', async () => {
    const s = new MemoryAuthzSource();
    s.item({ id: 'X', parentId: '00000000-0000-0000-0000-000000000000' });
    s.grant('X', { principal: 'u-dave', permissions: ['read'] });
    expect(await can(s, ['u-dave'], 'X', 'read')).toBe(true);
  });
});

describe('namespace and ReBAC principals', () => {
  it('a namespace grant covers sub-path principals', async () => {
    const s = new MemoryAuthzSource();
    s.item({ id: 'DOC', parentId: '00000000-0000-0000-0000-000000000000' });
    s.grant('DOC', { principal: 'acme.com/eng', permissions: ['read'] });
    expect(await can(s, ['acme.com/eng/platform'], 'DOC', 'read')).toBe(true);
    expect(await can(s, ['acme.com/sales'], 'DOC', 'read')).toBe(false);
  });

  it('a ReBAC relation grant matches group members', async () => {
    const s = new MemoryAuthzSource();
    s.item({ id: 'G', parentId: '00000000-0000-0000-0000-000000000000' });
    s.grant('G', { principal: { itemId: 'group-1', relation: 'member' }, permissions: ['write'] });
    s.member('u-erin', 'group-1', 'member');
    expect(await can(s, ['u-erin'], 'G', 'write')).toBe(true);
    expect(await can(s, ['u-frank'], 'G', 'write')).toBe(false);
  });
});

describe('helpers', () => {
  it('filterReadable keeps only readable ids, in order', async () => {
    const s = communityHub();
    expect(await filterReadable(s, anonymous, ['TX1', 'M', 'T'])).toEqual(['TX1']);
    expect(await filterReadable(s, team, ['TX1', 'M', 'T'])).toEqual(['TX1', 'M', 'T']);
  });

  it('emailVerified reflects the token claim', () => {
    expect(emailVerified({ email_verified: true })).toBe(true);
    expect(emailVerified({ email_verified: false })).toBe(false);
    expect(emailVerified({})).toBe(false);
  });

  it('denies a missing item', async () => {
    const s = new MemoryAuthzSource();
    expect(await decide(s, admin, 'ghost', 'read')).toEqual({ allow: false, reason: 'item-not-found' });
  });
});
