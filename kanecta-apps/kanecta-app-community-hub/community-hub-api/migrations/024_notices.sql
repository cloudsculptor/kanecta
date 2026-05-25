CREATE TABLE notices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heading           VARCHAR(255) NOT NULL,
  body              TEXT NOT NULL,
  notice_date       DATE,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'declined')),
  decline_reason    TEXT,
  submitted_by_id   VARCHAR(255) NOT NULL,
  submitted_by_name VARCHAR(255),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by_id    VARCHAR(255),
  reviewed_by_name  VARCHAR(255),
  reviewed_at       TIMESTAMPTZ
);
