-- Kanecta postgres schema — spec version 1.4.0
--
-- Adds schedule_data to the items table and registers 'schedule' as a valid type.
--
-- schedule_data  — JSONB payload for type: "schedule" items. Stores cronExpression,
--                  timezone, actionId, actionType, targetItemId, params, lastFiredAt,
--                  lastResult, and lastError. Managed exclusively by writeScheduleJson /
--                  readScheduleJson — never touched by the general update() path.
--
-- The scheduling query hits:
--   WHERE type = 'schedule' AND status = 'active' AND due_at <= NOW() AND deleted_at IS NULL
--
-- due_at is already indexed (idx_items_due_at if it exists, otherwise via idx_items_type).
-- The type filter is selective enough that a type+status composite index is not needed
-- for 1.4.0 volumes; add one if schedule items number in the tens of thousands.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS schedule_data JSONB;
