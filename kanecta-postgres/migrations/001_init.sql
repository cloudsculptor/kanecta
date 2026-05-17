-- Kanecta postgres schema — spec version 1.2.0
-- See specification.db.postgres.md for dialect notes.

CREATE TABLE IF NOT EXISTS items (
    id                  UUID         NOT NULL,
    parent_id           UUID         NOT NULL,
    value               TEXT,
    type                VARCHAR(50)  NOT NULL,
    type_id             UUID,
    owner               VARCHAR(255) NOT NULL,
    license             VARCHAR(100),
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    confidence          VARCHAR(20),
    created_at          TIMESTAMPTZ  NOT NULL,
    modified_at         TIMESTAMPTZ  NOT NULL,
    created_by          VARCHAR(255) NOT NULL,
    modified_by         VARCHAR(255) NOT NULL,
    cached_at           TIMESTAMPTZ,
    subscribed_at       TIMESTAMPTZ,
    subscription_source TEXT,
    is_remote           BOOLEAN      NOT NULL DEFAULT FALSE,
    tags                TEXT[]       NOT NULL DEFAULT '{}',

    CONSTRAINT pk_items
        PRIMARY KEY (id),
    CONSTRAINT fk_items_parent
        FOREIGN KEY (parent_id) REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_items_type CHECK (type IN (
        'string', 'number', 'text', 'file', 'symlink',
        'object', 'decision', 'annotation',
        'note', 'fact', 'claim', 'question', 'task',
        'concept', 'entity', 'event', 'code', 'url', 'image',
        'root', 'system_root', 'app_root', 'component_root', 'data_root'
    )),
    CONSTRAINT chk_items_confidence CHECK (
        confidence IS NULL OR confidence IN (
            'experimental', 'exploring', 'decided', 'locked',
            'low', 'medium', 'high', 'verified'
        )
    ),
    CONSTRAINT chk_items_type_id CHECK (
        (type = 'object' AND type_id IS NOT NULL) OR
        (type <> 'object' AND type_id IS NULL)
    ),
    CONSTRAINT chk_items_cached_at CHECK (
        (is_remote = TRUE AND cached_at IS NOT NULL) OR
        (is_remote = FALSE)
    )
);

CREATE INDEX IF NOT EXISTS idx_items_parent   ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_type     ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_type_id  ON items(type_id);
CREATE INDEX IF NOT EXISTS idx_items_owner    ON items(owner);
CREATE INDEX IF NOT EXISTS idx_items_siblings ON items(parent_id, sort_order);
-- GIN index on tags array for efficient tag queries
CREATE INDEX IF NOT EXISTS idx_items_tags     ON items USING GIN (tags);

CREATE TABLE IF NOT EXISTS aliases (
    alias     VARCHAR(255) NOT NULL,
    target_id UUID         NOT NULL,

    CONSTRAINT pk_aliases
        PRIMARY KEY (alias),
    CONSTRAINT fk_aliases_target
        FOREIGN KEY (target_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS annotations (
    id                   UUID         NOT NULL,
    target_id            UUID         NOT NULL,
    author               VARCHAR(255) NOT NULL,
    content              TEXT         NOT NULL,
    created_at           TIMESTAMPTZ  NOT NULL,
    parent_annotation_id UUID,

    CONSTRAINT pk_annotations
        PRIMARY KEY (id),
    CONSTRAINT fk_annotations_target
        FOREIGN KEY (target_id) REFERENCES items(id),
    CONSTRAINT fk_annotations_parent
        FOREIGN KEY (parent_annotation_id) REFERENCES annotations(id)
);

CREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_id);

-- Backlinks index: inline [[uuid]] references found in items.value
CREATE TABLE IF NOT EXISTS links (
    source_id UUID NOT NULL,
    target_id UUID NOT NULL,

    CONSTRAINT pk_links
        PRIMARY KEY (source_id, target_id),
    CONSTRAINT fk_links_source
        FOREIGN KEY (source_id) REFERENCES items(id),
    CONSTRAINT fk_links_target
        FOREIGN KEY (target_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

CREATE TABLE IF NOT EXISTS relationships (
    id         UUID         NOT NULL,
    source_id  UUID         NOT NULL,
    target_id  UUID         NOT NULL,
    type       VARCHAR(50)  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    note       TEXT,

    CONSTRAINT pk_relationships
        PRIMARY KEY (id),
    CONSTRAINT fk_relationships_source
        FOREIGN KEY (source_id) REFERENCES items(id),
    CONSTRAINT fk_relationships_target
        FOREIGN KEY (target_id) REFERENCES items(id),
    CONSTRAINT chk_relationships_type CHECK (type IN (
        'relates-to', 'depends-on', 'enables', 'contradicts',
        'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes'
    ))
);

CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);

-- history carries no FK to items — records must survive item deletion
CREATE TABLE IF NOT EXISTS history (
    id          UUID         NOT NULL,
    item_id     UUID         NOT NULL,
    snapshot    JSONB        NOT NULL,
    snapshot_at TIMESTAMPTZ  NOT NULL,
    changed_by  VARCHAR(255) NOT NULL,
    change_type VARCHAR(10)  NOT NULL,

    CONSTRAINT pk_history
        PRIMARY KEY (id),
    CONSTRAINT chk_history_change_type CHECK (
        change_type IN ('create', 'update', 'delete')
    )
);

CREATE INDEX IF NOT EXISTS idx_history_item ON history(item_id, snapshot_at);

CREATE TABLE IF NOT EXISTS config (
    key   VARCHAR(255) NOT NULL,
    value TEXT         NOT NULL,

    CONSTRAINT pk_config PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS files (
    id            UUID         NOT NULL,
    item_id       UUID         NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100),
    content       BYTEA,
    external_path TEXT,

    CONSTRAINT pk_files
        PRIMARY KEY (id),
    CONSTRAINT fk_files_item
        FOREIGN KEY (item_id) REFERENCES items(id),
    CONSTRAINT chk_files_storage CHECK (
        (content IS NOT NULL AND external_path IS NULL) OR
        (content IS NULL AND external_path IS NOT NULL)
    )
);
