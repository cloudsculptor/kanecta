-- Kanecta postgres schema — spec version 1.2.0
-- Adds:
--   - items.status / items.completed_at (present in metadata.json, missing from 001_init.sql)
--   - types: one row per type-definition item, mirrors type.json (1:1 with items)
--   - functions (+ child tables): one row per function item, mirrors function.json (1:1 with items)
--
-- Design choice: everything is normalised into real columns/tables — the only JSON
-- column anywhere in this schema is types.json_schema, which is the JSON Schema
-- Draft-07 document itself (kept verbatim since it IS a schema, not instance data).
-- Per-type tables (one per custom type with >=1 item, columns generated from
-- json_schema.properties) are created dynamically by the adapter, not here.
--
-- See specification.db.postgres.md for dialect notes.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS status       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- ─── types ──────────────────────────────────────────────────────────────────
-- One row per item with type='type'. Strict 1:1 with items via item_id.
-- table_name records the per-type table backing this type's instances, once
-- it has been created (NULL until the type's first 'object' item is created).

CREATE TABLE IF NOT EXISTS types (
    item_id                       UUID NOT NULL,
    table_name                    VARCHAR(63),

    meta_icon                     VARCHAR(100),
    meta_description              TEXT NOT NULL,
    meta_details                  TEXT,
    meta_keywords                 TEXT,
    meta_tags                     TEXT,
    meta_primary_field            VARCHAR(255),
    meta_ai_instructions_claude   TEXT,
    meta_functions_consumed_by    UUID[] NOT NULL DEFAULT '{}',
    meta_functions_produced_by    UUID[] NOT NULL DEFAULT '{}',

    json_schema                   JSONB NOT NULL,

    CONSTRAINT pk_types PRIMARY KEY (item_id),
    CONSTRAINT fk_types_item
        FOREIGN KEY (item_id) REFERENCES items(id),
    CONSTRAINT uq_types_table_name UNIQUE (table_name)
);

-- ─── functions ──────────────────────────────────────────────────────────────
-- One row per item with type='function'. Strict 1:1 with items via item_id.

CREATE TABLE IF NOT EXISTS functions (
    item_id              UUID NOT NULL,

    description          TEXT,
    is_async             BOOLEAN NOT NULL DEFAULT FALSE,
    is_ai                BOOLEAN NOT NULL DEFAULT FALSE,
    skill_id             UUID,
    return_type          TEXT,
    return_type_id       UUID,
    deprecated_notice    TEXT,
    body                 TEXT,
    include_kanecta_sdk  BOOLEAN NOT NULL DEFAULT TRUE,
    dependencies         TEXT[] NOT NULL DEFAULT '{}',

    CONSTRAINT pk_functions PRIMARY KEY (item_id),
    CONSTRAINT fk_functions_item
        FOREIGN KEY (item_id) REFERENCES items(id),
    CONSTRAINT fk_functions_skill
        FOREIGN KEY (skill_id) REFERENCES items(id),
    CONSTRAINT fk_functions_return_type
        FOREIGN KEY (return_type_id) REFERENCES items(id),
    CONSTRAINT chk_functions_return_type
        CHECK (
            (return_type IS NOT NULL AND return_type_id IS NULL) OR
            (return_type IS NULL AND return_type_id IS NOT NULL)
        )
);

-- function.typeParameters — ordered list of generic type parameters
CREATE TABLE IF NOT EXISTS function_type_parameters (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    function_id     UUID NOT NULL,
    sort_order      INTEGER NOT NULL,
    name            VARCHAR(255) NOT NULL,
    constraint_expr TEXT,
    default_type    TEXT,

    CONSTRAINT pk_function_type_parameters PRIMARY KEY (id),
    CONSTRAINT fk_function_type_parameters_function
        FOREIGN KEY (function_id) REFERENCES functions(item_id)
);

CREATE INDEX IF NOT EXISTS idx_function_type_parameters_function
    ON function_type_parameters(function_id, sort_order);

-- function.parameters — ordered list of parameters (type XOR typeId, per spec)
CREATE TABLE IF NOT EXISTS function_parameters (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    function_id UUID NOT NULL,
    sort_order  INTEGER NOT NULL,
    name        VARCHAR(255) NOT NULL,
    type        TEXT,
    type_id     UUID,

    CONSTRAINT pk_function_parameters PRIMARY KEY (id),
    CONSTRAINT fk_function_parameters_function
        FOREIGN KEY (function_id) REFERENCES functions(item_id),
    CONSTRAINT fk_function_parameters_type
        FOREIGN KEY (type_id) REFERENCES items(id),
    CONSTRAINT chk_function_parameters_type
        CHECK (
            (type IS NOT NULL AND type_id IS NULL) OR
            (type IS NULL AND type_id IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_function_parameters_function
    ON function_parameters(function_id, sort_order);

-- function.throws — error types a function may throw
CREATE TABLE IF NOT EXISTS function_throws (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    function_id UUID NOT NULL,
    sort_order  INTEGER NOT NULL,
    type        VARCHAR(255) NOT NULL,
    description TEXT,

    CONSTRAINT pk_function_throws PRIMARY KEY (id),
    CONSTRAINT fk_function_throws_function
        FOREIGN KEY (function_id) REFERENCES functions(item_id)
);

CREATE INDEX IF NOT EXISTS idx_function_throws_function
    ON function_throws(function_id, sort_order);
