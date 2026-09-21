-- Legacy SQLite imports may store DATETIME as text. Prisma compares dates using
-- integer Unix milliseconds; text values otherwise sort after every numeric date
-- and never become due. PostgreSQL timestamps do not need this repair.
UPDATE sources
SET next_fetch_at = CAST(strftime('%s', next_fetch_at) AS INTEGER) * 1000
                 + CAST(substr(strftime('%f', next_fetch_at), 4, 3) AS INTEGER)
WHERE typeof(next_fetch_at) = 'text'
  AND strftime('%s', next_fetch_at) IS NOT NULL;
