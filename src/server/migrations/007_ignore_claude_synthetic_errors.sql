CREATE TEMP TABLE _cc_synthetic_cleanup_sessions (
  session_id TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO _cc_synthetic_cleanup_sessions(session_id)
SELECT DISTINCT session_id
FROM messages
WHERE source = 'claude'
  AND model = '<synthetic>';

DELETE FROM messages
WHERE source = 'claude'
  AND model = '<synthetic>'
  AND (
    text_preview LIKE 'API Error:%'
    OR text_preview LIKE '% API Error:%'
    OR text_preview LIKE '%· API Error:%'
    OR text_preview LIKE 'You''ve hit your limit%'
  );

UPDATE messages
SET model = NULL
WHERE source = 'claude'
  AND model = '<synthetic>';

UPDATE sessions
SET started_at = COALESCE((SELECT MIN(timestamp) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    ended_at = COALESCE((SELECT MAX(timestamp) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    message_count = (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.session_id),
    total_input = COALESCE((SELECT SUM(input_tokens) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    total_output = COALESCE((SELECT SUM(output_tokens) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    total_cache_create = COALESCE((SELECT SUM(cache_creation_tokens) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    total_cache_read = COALESCE((SELECT SUM(cache_read_tokens) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    total_reasoning = COALESCE((SELECT SUM(reasoning_tokens) FROM messages WHERE messages.session_id = sessions.session_id), 0),
    total_cost_usd = COALESCE((SELECT SUM(cost_usd) FROM messages WHERE messages.session_id = sessions.session_id), 0)
WHERE session_id IN (SELECT session_id FROM _cc_synthetic_cleanup_sessions);

DELETE FROM models
WHERE model_name = '<synthetic>'
  AND NOT EXISTS (SELECT 1 FROM messages WHERE model = '<synthetic>')
  AND NOT EXISTS (SELECT 1 FROM pricing WHERE model_name = '<synthetic>');

DROP TABLE _cc_synthetic_cleanup_sessions;
