-- Kanecta postgres schema — spec version 1.2.0
-- Changes items.license from a free-text identifier (e.g. 'CC-BY-4.0') to a
-- UUID reference to a Licence item.
--
-- Licence is an ordinary standalone Kanecta custom type — name/url/text live
-- on its own per-type table (created via that type's sqlSchema, the same
-- mechanism every custom type uses), not a bespoke licences table. This keeps
-- the "every reusable concept is a standalone type, referenced by typeId"
-- rule intact and means filesystem-mode datastores get licence support for
-- free (custom-type items already round-trip through object.json/metadata.json
-- there) — no new well-known item kind or adapter machinery required.
--
-- Existing free-text values cannot be mapped to items, so they are cleared.

ALTER TABLE items
    ALTER COLUMN license TYPE UUID USING NULL::uuid;

ALTER TABLE items
    ADD CONSTRAINT fk_items_license FOREIGN KEY (license) REFERENCES items(id);

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.5.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
