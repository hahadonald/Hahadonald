# Adding and editing exhibits

Exhibits live in the Cloudflare D1 table `exhibits` (database `hahadonald-db`), not in any HTML file.
The homepage, permalink pages (`/files/<slug>`), `/random`, `/rss.xml` and `/sitemap.xml` all read from it,
so an INSERT is all it takes to publish. No deploy needed.

## Rules (see EDITORIAL_RULES.md)
- Every exhibit needs a named source and a date. No invented quotes.
- Put quoted words in double quotes only if the source prints them.
- `verdict` is the curator's one-line take (stored with its own surrounding quotes).

## New exhibit
Use the next `number` (max + 1) and `legacy_id` `ex` + that number padded to 3 digits.
Multi-value facet fields (`year`, `country`, `leader`, `adversary`) are `|`-separated.

```sql
INSERT INTO exhibits
  (legacy_id, slug, number, title, date_label, year, topic, claimtype, state, city, country,
   adversary, leader, family, nationality, speaking_country, market, tradepublic,
   body, source, verdict, mode)
VALUES
  ('ex114', 'url-slug-here', 114, 'Title', 'Dec 2026', '2026', 'Foreign Policy', 'Off-key remark',
   '', '', 'United States', '', '', '', '', 'United States', '', '',
   'Factual paragraph. Plain language, no new claims.',
   'Source: Outlet, Month D, YYYY.',
   '"Curator line."', 'exhibit');
```

## Correcting an exhibit (versioned, never overwrite)
1. Insert a new row copying the old one with the corrected `body`/`source` and `version = old + 1`.
2. Set the old row `is_current = 0` and `superseded_by = <new row id>`.
Votes follow `legacy_id`, so they carry over.

## Schema
See `src/migrations/0002_exhibits.sql`.

## Reads (silent counter)
Reads are counted per exhibit per day in `page_views` (permalink loads and pop-up opens; bots skipped). Not shown on the site.

```sql
-- Most read, last 7 days
SELECT slug, SUM(views) AS reads FROM page_views
WHERE day >= date('now', '-7 day') GROUP BY slug ORDER BY reads DESC LIMIT 10;
```
