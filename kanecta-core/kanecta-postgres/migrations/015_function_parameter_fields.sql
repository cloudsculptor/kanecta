-- function_parameters was missing several fields present in the function.json
-- spec (optional, rest, defaultValue, description) — added here so
-- read/writeFunctionJson can round-trip the full shape.

ALTER TABLE function_parameters
    ADD COLUMN IF NOT EXISTS optional      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rest          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS default_value TEXT,
    ADD COLUMN IF NOT EXISTS description   TEXT;
