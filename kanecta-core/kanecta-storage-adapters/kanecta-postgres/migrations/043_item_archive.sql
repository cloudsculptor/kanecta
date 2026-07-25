-- item_archive — soft delete becomes a physical row move (spec §item_archive
-- draft, owner-mandated 2026-07-19; prose awaiting sign-off in
-- kanecta-private plans/spec-changes-to-approve.md).
--
-- Delete = stamp deleted_at + move the row items → item_archive; restore =
-- clear it + move back; hard delete of an archived row = purge. Live queries
-- then never see deleted items BY CONSTRUCTION — no read path carries a
-- deleted_at exclusion filter, and the live `items` table stays lean.
--
-- THE PRIMARY CONSTRAINT: `item_archive` has EXACTLY the same schema as
-- `items` — same columns, order, types, defaults, nullability — so a row
-- moves verbatim (INSERT … SELECT *). LIKE … INCLUDING ALL guarantees that
-- at creation; every future `items` migration MUST alter item_archive in the
-- same step, and the conformance drift test fails the suite on any
-- divergence. (deleted_at is deliberately KEPT in both tables: always null
-- in live rows — redundancy accepted, schema identity ranks higher.)
--
-- This migration is DDL-only. Existing flagged rows (deleted_at IS NOT NULL)
-- are moved by the adapter on init/open — the code path handles payload
-- capture and derived-row cleanup correctly (0e5898f8 auto-upgrade pattern).

CREATE TABLE IF NOT EXISTS item_archive (LIKE items INCLUDING ALL);

-- The archive spine's write-side payload section. On postgres the ONLY
-- payload store is the per-type obj_<typeId> projection row, and that row
-- cascades away when the items row moves out — so the archive move captures
-- the payload here (camelCase, the writeObjectJson shape) and restore
-- repopulates the projection from it. Mirrors the filesystem adapter, where
-- item.json (which carries the payload) moves wholesale into archive/, and
-- the spec's envelope-section rule (a physical decomposition of the archive
-- spine, not a fifth table kind).
CREATE TABLE IF NOT EXISTS item_archive_payload (
    item_id UUID NOT NULL,
    payload JSONB,
    CONSTRAINT pk_item_archive_payload PRIMARY KEY (item_id),
    CONSTRAINT fk_item_archive_payload_item
        FOREIGN KEY (item_id) REFERENCES item_archive(id) ON DELETE CASCADE
);

-- ── Foreign keys that cannot span the items ∪ item_archive union ────────────
--
-- A reference may now legitimately point at an ARCHIVED item (a live child
-- under an archived parent; a message whose thread is archived; the spec's
-- relation-survives-soft-delete rule) and one FK cannot reference two
-- tables. Every non-CASCADE FK that references items(id) is therefore
-- dropped: the two items self-FKs (parent, license), the perf_backlinks
-- convenience FKs, and every compiler-emitted payload-reference FK on obj_
-- tables (the compiler no longer emits them). The ON DELETE CASCADE spine
-- FKs (obj_/perf item_id → items) are KEPT — they are what makes an archive
-- move drop the derived rows for free, and an obj_ row's own item can never
-- be archived while the row exists.
--
-- Union referential integrity (every live parent_id/license/reference
-- resolves in items ∪ item_archive) moves to the integrity checker.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'items'::regclass
      AND confdeltype <> 'c'          -- keep the ON DELETE CASCADE spine FKs
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

-- ── Deferred hard-delete guard (the FKs' orphan protection, preserved) ──────
--
-- fk_items_parent / fk_items_license used to block a hard delete that would
-- orphan live rows. This constraint trigger preserves exactly that, with the
-- same end-of-transaction timing (DEFERRABLE INITIALLY DEFERRED, matching
-- the FKs it replaces) — while letting ARCHIVE MOVES pass: a deleted row
-- that landed in item_archive within the same transaction is a move, not a
-- removal, and live references into the archive are legitimate.
CREATE OR REPLACE FUNCTION kanecta_items_delete_guard() RETURNS trigger AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM item_archive WHERE id = OLD.id) THEN
    RETURN NULL;   -- archive move, not a hard delete — nothing to guard
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE parent_id = OLD.id) THEN
    RAISE EXCEPTION 'delete on table "items" would orphan live children of % (fk_items_parent)', OLD.id
      USING ERRCODE = '23503', CONSTRAINT = 'fk_items_parent';
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE license = OLD.id) THEN
    RAISE EXCEPTION 'delete on table "items" would dangle live license references to % (fk_items_license)', OLD.id
      USING ERRCODE = '23503', CONSTRAINT = 'fk_items_license';
  END IF;
  RETURN NULL;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_delete_guard ON items;
CREATE CONSTRAINT TRIGGER trg_items_delete_guard
  AFTER DELETE ON items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kanecta_items_delete_guard();
