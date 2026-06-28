CREATE TABLE fcm_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE TABLE notification_preferences (
  user_id   TEXT NOT NULL,
  category  TEXT NOT NULL CHECK (category IN ('events', 'discussions', 'suggestions', 'pages')),
  enabled   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category)
);
