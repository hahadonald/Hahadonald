-- Reference schema for the exhibits table (applied to production D1 manually).
CREATE TABLE IF NOT EXISTS exhibits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  date_label TEXT NOT NULL,
  year TEXT, topic TEXT, claimtype TEXT, state TEXT, city TEXT, country TEXT,
  adversary TEXT, leader TEXT, family TEXT, nationality TEXT, speaking_country TEXT,
  market TEXT, tradepublic TEXT,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  verdict TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'exhibit',
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  superseded_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_exhibits_current ON exhibits (is_current);
CREATE INDEX IF NOT EXISTS idx_exhibits_slug ON exhibits (slug, is_current);
CREATE INDEX IF NOT EXISTS idx_exhibits_legacy ON exhibits (legacy_id, is_current);
CREATE INDEX IF NOT EXISTS idx_exhibits_year ON exhibits (year);
CREATE INDEX IF NOT EXISTS idx_exhibits_number ON exhibits (number);
