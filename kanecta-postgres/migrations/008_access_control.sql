-- Kanecta postgres schema — spec version 1.2.0
-- Foundational access-control storage:
--
--   - items.visibility — coarse default access level (cheap, no-join fast path
--     for the common case: 'private' / 'organisation' / 'public')
--
--   - item_grants — fine-grained per-principal grants layered on top, for
--     read / write / subscribe, scoped to individual items
--
-- principal_id is a deliberately bare UUID — NOT a foreign key to items(id).
-- A principal (user, group, service account, ...) may be a Kanecta item one
-- day, a Keycloak-resolved id today, or something else entirely tomorrow;
-- grants must keep working unchanged regardless of where/how identities are
-- stored. principal_type records what kind of principal it is so the
-- application knows how to resolve it — deliberately not constrained to a
-- fixed set, since new principal kinds (service accounts, API keys, ...)
-- should not require a migration to introduce.
--
-- See specification.db.postgres.md for the full rationale.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';

ALTER TABLE items
    ADD CONSTRAINT chk_items_visibility CHECK (visibility IN ('private', 'organisation', 'public'));

CREATE INDEX IF NOT EXISTS idx_items_visibility ON items(visibility);

CREATE TABLE IF NOT EXISTS item_grants (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id        UUID        NOT NULL REFERENCES items(id),
    principal_id   UUID        NOT NULL,
    principal_type VARCHAR(50) NOT NULL,
    permission     VARCHAR(20) NOT NULL,
    granted_by     UUID        NOT NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ,
    CONSTRAINT chk_item_grants_permission CHECK (permission IN ('read', 'write', 'subscribe')),
    CONSTRAINT uq_item_grants_principal_permission UNIQUE (item_id, principal_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_item_grants_item ON item_grants(item_id);
CREATE INDEX IF NOT EXISTS idx_item_grants_principal ON item_grants(principal_id);

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.4.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
