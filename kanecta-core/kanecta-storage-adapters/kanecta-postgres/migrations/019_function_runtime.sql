-- Kanecta postgres schema — spec version 1.4.0
--
-- Adds runtime and bundle_hash to the functions table.
-- Before this migration, every function was implicitly typescript — the adapter
-- now persists the runtime name explicitly so multi-runtime datastores can coexist.
--
-- runtime     — open string; identifies the execution environment.
--               Known values: "typescript", "python". Free-form — new runtimes
--               can be added without a schema change. Defaults to "typescript"
--               so existing rows are interpreted correctly after migration.
-- bundle_hash — JSONB object keyed by runtime name, each value a "sha256:<hex>"
--               string covering the source files in that runtime's scaffold
--               directory (excluding node_modules/, dist/, __pycache__/).
--               NULL until the bundle has been saved at least once.

ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS runtime      TEXT    NOT NULL DEFAULT 'typescript',
  ADD COLUMN IF NOT EXISTS bundle_hash  JSONB;
