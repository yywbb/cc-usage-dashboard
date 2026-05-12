ALTER TABLE messages ADD COLUMN response_error INTEGER NOT NULL DEFAULT 0;

UPDATE messages
SET response_error = 1
WHERE source = 'claude'
  AND (
    text_preview LIKE 'API Error:%'
    OR text_preview LIKE '% API Error:%'
    OR text_preview LIKE '%· API Error:%'
    OR text_preview LIKE 'You''ve hit your limit%'
  );

-- Re-read source logs once so API-error rows removed by migration 007 can be
-- reinserted with response_error=1. Existing normal messages are ignored by
-- their message_id primary key.
DELETE FROM scan_cursor;
