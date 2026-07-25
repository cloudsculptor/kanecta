-- Seed site_node trees for Meeting Minutes and Web App Development Roadmap.
-- owner_type in pages: min-<category-slug> / road-<category-slug>

DO $$
DECLARE
  v_minutes_id   UUID;
  v_roadmap_id   UUID;
  v_cb_id        UUID;
  v_vol_id       UUID;
  v_progress_id  UUID;
  v_planned_id   UUID;
  v_done_id      UUID;
BEGIN

  -- ── Root: Meeting Minutes ─────────────────────────────────────────────────
  SELECT id INTO v_minutes_id
    FROM site_nodes WHERE slug = 'minutes' AND parent_id IS NULL;
  IF v_minutes_id IS NULL THEN
    INSERT INTO site_nodes (slug, title, node_type, metadata, sort_order)
    VALUES ('minutes', 'Meeting Minutes', 'index', '{"gov_type": "minutes"}', 2)
    RETURNING id INTO v_minutes_id;
  END IF;

  -- ── Root: Web App Development Roadmap ────────────────────────────────────
  SELECT id INTO v_roadmap_id
    FROM site_nodes WHERE slug = 'roadmap' AND parent_id IS NULL;
  IF v_roadmap_id IS NULL THEN
    INSERT INTO site_nodes (slug, title, node_type, metadata, sort_order)
    VALUES ('roadmap', 'Web App Development Roadmap', 'index', '{"gov_type": "roadmap"}', 3)
    RETURNING id INTO v_roadmap_id;
  END IF;

  -- ── Minutes groups ────────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_minutes_id, 'custodian-board', 'Custodian Board', 'index', '{"level": "group"}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_cb_id;
  IF v_cb_id IS NULL THEN
    SELECT id INTO v_cb_id FROM site_nodes WHERE parent_id = v_minutes_id AND slug = 'custodian-board';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_minutes_id, 'volunteers', 'Volunteers', 'index', '{"level": "group"}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_vol_id;
  IF v_vol_id IS NULL THEN
    SELECT id INTO v_vol_id FROM site_nodes WHERE parent_id = v_minutes_id AND slug = 'volunteers';
  END IF;

  -- ── Minutes categories ────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_cb_id, '2025', '2025', 'index',
     '{"level": "category", "description": "Custodian Board meeting minutes from 2025."}', 0),
    (v_cb_id, '2026', '2026', 'index',
     '{"level": "category", "description": "Custodian Board meeting minutes from 2026."}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_vol_id, 'vol-2025', '2025', 'index',
     '{"level": "category", "description": "Volunteer team meeting minutes from 2025."}', 0),
    (v_vol_id, 'vol-2026', '2026', 'index',
     '{"level": "category", "description": "Volunteer team meeting minutes from 2026."}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  -- ── Roadmap groups ────────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_roadmap_id, 'in-progress', 'In Progress', 'index', '{"level": "group"}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_progress_id;
  IF v_progress_id IS NULL THEN
    SELECT id INTO v_progress_id FROM site_nodes WHERE parent_id = v_roadmap_id AND slug = 'in-progress';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_roadmap_id, 'planned', 'Planned', 'index', '{"level": "group"}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_planned_id;
  IF v_planned_id IS NULL THEN
    SELECT id INTO v_planned_id FROM site_nodes WHERE parent_id = v_roadmap_id AND slug = 'planned';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_roadmap_id, 'completed', 'Completed', 'index', '{"level": "group"}', 2)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_done_id;
  IF v_done_id IS NULL THEN
    SELECT id INTO v_done_id FROM site_nodes WHERE parent_id = v_roadmap_id AND slug = 'completed';
  END IF;

  -- ── Roadmap categories ────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_progress_id, 'minutes-roadmap', 'Meeting Minutes & Roadmap', 'index',
     '{"level": "category", "description": "Database-driven meeting minutes and web app development roadmap."}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_planned_id, 'private-messaging', 'Private Messaging', 'index',
     '{"level": "category", "description": "Direct private messaging between members."}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_done_id, 'governance-pages', 'Governance Pages', 'index',
     '{"level": "category", "description": "Database-driven policies, procedures, and governance documents."}', 0),
    (v_done_id, 'discussions', 'Discussions', 'index',
     '{"level": "category", "description": "Real-time Slack-style threaded discussions for the volunteer team."}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

END $$;
