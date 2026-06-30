-- Kanecta postgres schema — spec version 1.2.0
-- Two fixes surfaced while writing the filesystem->postgres migration script:
--
-- 1. chk_items_type was stale relative to the authoritative type list
--    (kanecta-specification/1.2.0/types/primitive.json: primitive ∪ structured ∪
--    wellKnown) plus the special 'type' value used by type-definition items
--    (metadata.json sets type: "type" — see specification.md "Custom Types").
--    Missing: heading, function, markdown, runner, type. Stale/unused: fact, code.
--
-- 2. items.parent_id is now nullable — most items (type-definitions, functions,
--    skills, etc.) don't have a natural place in the tree. Tree placement will
--    eventually become its own concept (see project_tree_placement_redesign);
--    for now, "no parent" simply means the item isn't shown in any tree.
--    The items_sync_children trigger (003) is already NULL-safe: `id = NULL`
--    never matches in its WHERE clauses, so homeless items are a silent no-op.
--
-- See specification.db.postgres.md for dialect notes.

ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_type;
ALTER TABLE items ADD CONSTRAINT chk_items_type CHECK (type IN (
    'string', 'number', 'text', 'heading', 'file', 'symlink', 'url', 'image',
    'function', 'markdown', 'runner',
    'object', 'decision', 'annotation', 'claim', 'question', 'task',
    'note', 'concept', 'entity', 'event',
    'root',
    'type'
));

ALTER TABLE items ALTER COLUMN parent_id DROP NOT NULL;

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.1.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
