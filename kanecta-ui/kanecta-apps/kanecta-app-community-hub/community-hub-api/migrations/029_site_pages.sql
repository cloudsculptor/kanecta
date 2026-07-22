-- Add 'site' as a valid owner_type for top-level pages managed by moderators.
-- These pages are seeded by developers and can be edited by the moderator role,
-- but cannot be created or deleted via the app.
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_owner_type_check;
ALTER TABLE pages ADD CONSTRAINT pages_owner_type_check
  CHECK (owner_type IN ('private', 'group', 'business', 'site'));

-- Seed the Transport page. Content starts empty; a moderator populates it via the editor.
-- The React component falls back to static JSX until DB content exists.
INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name, public, version, owner_type, owner_id)
VALUES ('transport', 'Transport', '{}', 'system', 'System', TRUE, 1, 'site', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO page_history (page_id, action, version, content_json, user_id, user_name)
SELECT id, 'Created', 1, '{}', 'system', 'System'
FROM pages WHERE slug = 'transport'
  AND NOT EXISTS (SELECT 1 FROM page_history WHERE page_id = pages.id);
