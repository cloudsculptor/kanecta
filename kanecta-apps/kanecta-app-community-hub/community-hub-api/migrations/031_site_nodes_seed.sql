-- Seed the governance navigation tree into site_nodes.
-- Groups are visual-only organisers; categories map to :category URL params.
-- owner_type in pages: gov-proc-<category-slug> / gov-pol-<category-slug>

DO $$
DECLARE
  v_procedures_id     UUID;
  v_policies_id       UUID;
  v_content_comm_id   UUID;
  v_technology_id     UUID;
  v_gov_legal_id      UUID;
  v_custodian_id      UUID;
  v_volunteers_id     UUID;
BEGIN

  -- ── Root: Procedures ──────────────────────────────────────────────────────
  SELECT id INTO v_procedures_id
    FROM site_nodes WHERE slug = 'procedures' AND parent_id IS NULL;
  IF v_procedures_id IS NULL THEN
    INSERT INTO site_nodes (slug, title, node_type, metadata, sort_order)
    VALUES ('procedures', 'Procedures', 'index', '{"gov_type": "procedure"}', 0)
    RETURNING id INTO v_procedures_id;
  END IF;

  -- ── Root: Policies ────────────────────────────────────────────────────────
  SELECT id INTO v_policies_id
    FROM site_nodes WHERE slug = 'policies' AND parent_id IS NULL;
  IF v_policies_id IS NULL THEN
    INSERT INTO site_nodes (slug, title, node_type, metadata, sort_order)
    VALUES ('policies', 'Policies', 'index', '{"gov_type": "policy"}', 1)
    RETURNING id INTO v_policies_id;
  END IF;

  -- ── Procedure groups ──────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_procedures_id, 'content-community', 'Content & Community', 'index', '{"level": "group"}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_content_comm_id;
  IF v_content_comm_id IS NULL THEN
    SELECT id INTO v_content_comm_id
      FROM site_nodes WHERE parent_id = v_procedures_id AND slug = 'content-community';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_procedures_id, 'technology', 'Technology', 'index', '{"level": "group"}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_technology_id;
  IF v_technology_id IS NULL THEN
    SELECT id INTO v_technology_id
      FROM site_nodes WHERE parent_id = v_procedures_id AND slug = 'technology';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_procedures_id, 'governance-legal', 'Governance & Legal', 'index', '{"level": "group"}', 2)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_gov_legal_id;
  IF v_gov_legal_id IS NULL THEN
    SELECT id INTO v_gov_legal_id
      FROM site_nodes WHERE parent_id = v_procedures_id AND slug = 'governance-legal';
  END IF;

  -- ── Content & Community categories ────────────────────────────────────────
  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_content_comm_id, 'content-moderation', 'Content Moderation', 'index',
     '{"level": "category", "description": "How reported or problematic content is reviewed, removed, and escalated."}', 0),
    (v_content_comm_id, 'volunteer-onboarding', 'Volunteer Onboarding', 'index',
     '{"level": "category", "description": "How new volunteers are welcomed, given access, and supported."}', 1),
    (v_content_comm_id, 'complaint-handling', 'Complaint Handling', 'index',
     '{"level": "category", "description": "How formal complaints about member or volunteer conduct are investigated and resolved."}', 2)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  -- ── Technology categories ─────────────────────────────────────────────────
  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_technology_id, 'it-incident-response', 'IT Incident Response', 'index',
     '{"level": "category", "description": "How the team responds to outages, security incidents, and infrastructure failures."}', 0),
    (v_technology_id, 'domain-and-hosting', 'Domain and Hosting Management', 'index',
     '{"level": "category", "description": "Keeping featherston.co.nz and all hosting infrastructure secure and continuously available."}', 1),
    (v_technology_id, 'backup-and-recovery', 'Backup and Recovery', 'index',
     '{"level": "category", "description": "How site data is backed up, tested, and restored."}', 2)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  -- ── Governance & Legal categories ─────────────────────────────────────────
  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_gov_legal_id, 'board-meeting', 'Board Meeting', 'index',
     '{"level": "category", "description": "How a standard Custodian Board meeting is prepared for and run."}', 0),
    (v_gov_legal_id, 'agm', 'Annual General Meeting', 'index',
     '{"level": "category", "description": "How the AGM is planned, run, and recorded — including sortition."}', 1),
    (v_gov_legal_id, 'financial-reporting', 'Financial Reporting', 'index',
     '{"level": "category", "description": "Day-to-day financial management, quarterly reporting, and annual accounts."}', 2),
    (v_gov_legal_id, 'statutory-compliance', 'Statutory Compliance', 'index',
     '{"level": "category", "description": "Meeting the Society''s legal obligations under the Incorporated Societies Act 2022."}', 3)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  -- ── Policy groups ─────────────────────────────────────────────────────────

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_policies_id, 'custodian-board', 'Custodian Board', 'index', '{"level": "group"}', 0)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_custodian_id;
  IF v_custodian_id IS NULL THEN
    SELECT id INTO v_custodian_id
      FROM site_nodes WHERE parent_id = v_policies_id AND slug = 'custodian-board';
  END IF;

  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES (v_policies_id, 'volunteers', 'Volunteers', 'index', '{"level": "group"}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING
  RETURNING id INTO v_volunteers_id;
  IF v_volunteers_id IS NULL THEN
    SELECT id INTO v_volunteers_id
      FROM site_nodes WHERE parent_id = v_policies_id AND slug = 'volunteers';
  END IF;

  -- ── Custodian Board categories ────────────────────────────────────────────
  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_custodian_id, 'custodian-bylaws', 'Bylaws', 'index',
     '{"level": "category", "description": "Formal, binding rules for how the Custodian Board operates."}', 0),
    (v_custodian_id, 'custodian-guidelines', 'Guidelines', 'index',
     '{"level": "category", "description": "Practical guidance for Board members on running meetings, working with volunteers, and handing over."}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

  -- ── Volunteer categories ──────────────────────────────────────────────────
  INSERT INTO site_nodes (parent_id, slug, title, node_type, metadata, sort_order)
  VALUES
    (v_volunteers_id, 'volunteer-bylaws', 'Bylaws', 'index',
     '{"level": "category", "description": "Formal expectations for volunteers — minimal by design."}', 0),
    (v_volunteers_id, 'volunteer-guidelines', 'Guidelines', 'index',
     '{"level": "category", "description": "Practical guidance on how work gets done, decisions get made, and concerns get raised."}', 1)
  ON CONFLICT ON CONSTRAINT site_nodes_parent_id_slug_key DO NOTHING;

END $$;
