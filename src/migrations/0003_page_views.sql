-- Silent read counter: one aggregate row per exhibit per day (no visitor data).
CREATE TABLE IF NOT EXISTS page_views (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
