-- Kanecta postgres schema — spec version 1.4.0
--
-- The activity log (spec §activityPayload, §cqrs-projections): the SECOND
-- append-only exempt log the four-table law names alongside item_history.
-- item_history tracks WHAT CHANGED (state snapshots); activity tracks WHAT
-- HAPPENED (discrete workspace events: item viewed, search performed, sync
-- completed). Recording is gated by rootPayload.activity ('NONE' disables);
-- events are append-only, are never themselves logged, and have no history.
--
-- Like item_history, activity carries no FK to items — events must survive
-- item deletion (target_id may point at an item that no longer exists).

CREATE TABLE IF NOT EXISTS activity (
    id          UUID          NOT NULL,
    event_type  VARCHAR(255)  NOT NULL,
    actor       VARCHAR(255)  NOT NULL,
    target_id   UUID,
    data        JSONB,
    occurred_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_activity PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_activity_target   ON activity(target_id);
CREATE INDEX IF NOT EXISTS idx_activity_type     ON activity(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity(occurred_at);
