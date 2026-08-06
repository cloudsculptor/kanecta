-- 036: Seed the Seniors page so moderators get the "Edit this page" link.
--
-- SiteEditablePage only shows that link when a pages row exists for the slug
-- with owner_type = 'site'. Content starts empty, so the React component keeps
-- rendering its static JSX until a moderator saves something through the
-- editor — same arrangement as Transport in 029_site_pages.sql.
--
-- Safe to re-run: ON CONFLICT (slug) DO NOTHING.

INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name, public, version, owner_type, owner_id)
VALUES ('seniors', 'Seniors', '{}', 'system', 'System', TRUE, 1, 'site', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO page_history (page_id, action, version, content_json, user_id, user_name)
SELECT id, 'Created', 1, '{}', 'system', 'System'
FROM pages WHERE slug = 'seniors'
  AND NOT EXISTS (SELECT 1 FROM page_history WHERE page_id = pages.id);
