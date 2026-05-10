-- Push notification device tokens — one row per user per device
CREATE TABLE push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  subscription JSONB      NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX push_subscriptions_user_endpoint
  ON push_subscriptions (user_id, (subscription->>'endpoint'));

-- Per-thread notification opt-in — bell icon in thread header
CREATE TABLE thread_notification_subscriptions (
  user_id    TEXT NOT NULL,
  thread_id  UUID NOT NULL REFERENCES discussions_threads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_id)
);
