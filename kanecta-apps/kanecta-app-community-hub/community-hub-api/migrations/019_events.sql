CREATE TYPE event_status AS ENUM ('pending', 'approved', 'declined');

CREATE TABLE events (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT         NOT NULL,
  description       TEXT,
  start_date        DATE         NOT NULL,
  start_time        TIME,
  end_date          DATE,
  end_time          TIME,
  website           TEXT,
  phone             TEXT,
  email             TEXT,
  status            event_status NOT NULL DEFAULT 'pending',
  decline_reason    TEXT,
  submitted_by_id   VARCHAR(255) NOT NULL,
  submitted_by_name VARCHAR(255) NOT NULL,
  submitted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_by_id    VARCHAR(255),
  reviewed_by_name  VARCHAR(255),
  reviewed_at       TIMESTAMPTZ
);

CREATE INDEX events_status_idx     ON events (status);
CREATE INDEX events_start_date_idx ON events (start_date);

CREATE TABLE event_files (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_id    UUID        NOT NULL REFERENCES files(id)  ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL DEFAULT 'gallery',
  position   SMALLINT    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, file_id)
);

CREATE INDEX event_files_event_idx ON event_files (event_id);
