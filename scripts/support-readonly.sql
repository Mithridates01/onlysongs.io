-- A read-only login for troubleshooting accounts (support_ro).
--
-- It can read only the views in the `support` schema below, which leave out
-- every secret: password hashes, encrypted Spotify keys and tokens, OAuth
-- state, and email-link and invite token hashes. It cannot see the real
-- tables or change anything.
--
-- Run once as the database owner (Railway: postgres > Database > Query, or
-- `railway connect postgres`). Replace CHANGE_ME with a long random password
-- first, and keep that password in 1Password. Re-running is safe; it also
-- picks up new columns after a migration if you re-run it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'support_ro') THEN
    CREATE ROLE support_ro LOGIN PASSWORD 'CHANGE_ME';
  END IF;
END
$$;
ALTER ROLE support_ro SET default_transaction_read_only = on;
ALTER ROLE support_ro CONNECTION LIMIT 2;

CREATE SCHEMA IF NOT EXISTS support;
REVOKE ALL ON SCHEMA public FROM support_ro;

CREATE OR REPLACE VIEW support.users AS
  SELECT id, email, created_at, email_verified_at, is_admin FROM public.users;

CREATE OR REPLACE VIEW support.spotify_connections AS
  SELECT user_id, right(client_id, 4) AS client_id_last4, status, spotify_user_id, expires_at,
         refresh_token_enc IS NOT NULL AS signed_in,
         oauth_state_expires_at AS sign_in_expires_at
  FROM public.spotify_connections;

CREATE OR REPLACE VIEW support.blocker_settings AS
  SELECT user_id, enabled, interval_seconds, replacement_uri, replacement_label, replacement_kind,
         block_podcasts, block_audiobooks, quiet_hours, allowed_show_ids, time_zone
  FROM public.blocker_settings;

CREATE OR REPLACE VIEW support.poll_state AS
  SELECT user_id, last_checked_at, cooldown_until, paused_until, pause_reason, consecutive_failures,
         last_error, now_playing_kind, now_playing_title
  FROM public.poll_state;

CREATE OR REPLACE VIEW support.activity_log AS
  SELECT id, user_id, at, show_name, episode_name, device_name, action, result, http_status
  FROM public.activity_log;

CREATE OR REPLACE VIEW support.sessions AS
  SELECT id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent FROM public.sessions;

CREATE OR REPLACE VIEW support.early_access_requests AS
  SELECT id, email, status, created_at, decided_at, invite_expires_at, joined_at
  FROM public.early_access_requests;

GRANT USAGE ON SCHEMA support TO support_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA support TO support_ro;
ALTER ROLE support_ro SET search_path = support;
