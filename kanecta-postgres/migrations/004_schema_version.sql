-- Kanecta postgres schema — spec version 1.2.0
-- Adds schema_version: lets the application assert its expected schema version
-- matches the database it's connected to, so app and database stay in lock-step.
--
-- Singleton table (one row, enforced via the id=TRUE check). version is a
-- "major.minor.patch" semver string, e.g. '1.1.1'. Each future migration that
-- changes the schema should bump it via the upsert pattern shown at the bottom.

CREATE TABLE IF NOT EXISTS schema_version (
    id         BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
    version    VARCHAR(32) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.0.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();

-- Future migrations bump the version like so:
--   INSERT INTO schema_version (id, version)
--   VALUES (TRUE, '1.1.0')
--   ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
