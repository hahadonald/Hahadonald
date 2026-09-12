-- Votes: one row per (exhibit, visitor). Existence = "voted".
-- Deleting the row is how a vote gets un-toggled.
CREATE TABLE votes (
  exhibit_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (exhibit_id, visitor_id)
);

CREATE INDEX idx_votes_exhibit ON votes (exhibit_id);

-- Forward-looking, not wired into the site yet: once the editorial-mode
-- content (Opinion, Deep Dive, etc. per EDITORIAL_RULES.md) is ready to
-- move off static HTML, it lands here.
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN (
    'personal_experience', 'opinion', 'explainer', 'deep_dive',
    'notebook', 'rant', 'story', 'field_notes', 'exhibit'
  )),
  body TEXT NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Forward-looking: Stripe webhook idempotency, per the agreed footgun list.
-- An event_id already in this table means "already processed, skip it."
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
