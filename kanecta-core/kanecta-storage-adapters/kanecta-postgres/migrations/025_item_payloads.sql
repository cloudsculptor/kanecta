-- 025_item_payloads.sql
--
-- A GENERIC payload store for structured built-in-type items (grant, query,
-- formula, subscription, ...) whose payload is a small JSON object — NOT a user
-- object-type row (those live in the per-type obj_<typeId> tables). One row per
-- item, strict 1:1 with items via item_id.
--
-- This mirrors the existing per-type payload tables (documents, ...) but is
-- domain-agnostic: a new built-in structured type needs no new table. Derived
-- lookup indexes hang off the JSONB (e.g. governedItemId for grants) — always
-- rebuildable from items, never the source of truth (spec §built-in payloads).

CREATE TABLE IF NOT EXISTS item_payloads (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (item_id)
);

-- Grant resolution: every grant governing item X is a `grant` item whose
-- payload.governedItemId = X. This functional index makes that lookup O(log n)
-- (the O(1) `payload_grant` derived table is a later optimization over the same
-- source rows).
CREATE INDEX IF NOT EXISTS idx_item_payloads_governed_item
  ON item_payloads ((payload->>'governedItemId'));
