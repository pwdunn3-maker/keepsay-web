-- event_vault_transcode.sql — Event Vault in-house transcode pipeline (2026-07-19)
-- Guest recordings are WebM (unplayable on iOS); this adds the columns + the atomic
-- claim function the transcode cron uses. Run each numbered block SEPARATELY in the
-- Supabase SQL editor and eyeball the verification SELECT after each (the editor only
-- shows the LAST statement's result when blocks are batched).
-- Decision + rationale: docs/server-transcode-plan.md (in-house, privacy decider).

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 1 — columns on event_contributions.
--   playback_url          the transcoded, iOS-playable mp4/m4a path (WebM master
--                         stays in recording_url — archival master, preserved).
--   transcode_status      not_needed | pending_transcode | transcoding | transcoded | transcode_failed
--   transcode_attempts    retry counter (capped at 3 → transcode_failed).
--   transcode_claimed_at  set when the cron claims a row; used for the >15min stuck-reclaim.
--   transcode_alerted     so the failure alert email fires exactly ONCE.
ALTER TABLE public.event_contributions
  ADD COLUMN IF NOT EXISTS playback_url          text,
  ADD COLUMN IF NOT EXISTS transcode_status      text,
  ADD COLUMN IF NOT EXISTS transcode_attempts    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcode_claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS transcode_alerted     boolean NOT NULL DEFAULT false;
-- verify:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='event_contributions'
  AND column_name IN ('playback_url','transcode_status','transcode_attempts','transcode_claimed_at','transcode_alerted')
ORDER BY column_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 2 — index for the cron claim (find claimable rows fast).
CREATE INDEX IF NOT EXISTS idx_event_contributions_transcode
  ON public.event_contributions (transcode_status, transcode_claimed_at);
-- verify:
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='event_contributions' AND indexname='idx_event_contributions_transcode';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 3 — atomic claim function. Claims ONE row and flips it to 'transcoding'
-- in a single statement so overlapping cron invocations (a 90-150s job + a
-- frequent cron) can never grab the same row (FOR UPDATE SKIP LOCKED). Also
-- reclaims rows stuck in 'transcoding' >15 min (a crashed function must not
-- strand a clip). The transcode function is the SOLE arbiter of the terminal
-- 'transcode_failed' state (after 3 attempts) — so this claim intentionally does
-- NOT filter on attempts, letting a stuck/crashed row always be recoverable.
CREATE OR REPLACE FUNCTION public.claim_vault_transcode()
RETURNS SETOF public.event_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM public.event_contributions
  WHERE status = 'complete'
    AND (
      transcode_status = 'pending_transcode'
      OR (transcode_status = 'transcoding' AND transcode_claimed_at < now() - interval '15 minutes')
    )
  ORDER BY submitted_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.event_contributions
     SET transcode_status     = 'transcoding',
         transcode_claimed_at = now(),
         transcode_attempts   = transcode_attempts + 1
   WHERE id = claimed_id
  RETURNING *;
END;
$$;
-- verify (should return the function, SECURITY DEFINER):
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'claim_vault_transcode';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 3b — LOCK DOWN EXECUTE (do NOT skip). Postgres grants EXECUTE on a new
-- function to PUBLIC by default, and PostgREST exposes public-schema functions as an
-- RPC surface (/rest/v1/rpc/claim_vault_transcode). Without this REVOKE, any anon or
-- authenticated client (the anon key is public) could call this SECURITY DEFINER
-- function — which bypasses RLS by design — in a loop to repeatedly claim rows and
-- burn transcode_attempts past the cap, deliberately stranding guest clips into
-- transcode_failed: a DoS on sealed wedding messages via one unauthenticated RPC. The
-- cron calls this with the SERVICE-ROLE key, which retains EXECUTE — nothing breaks;
-- the door just closes. (Same discipline as the V2 client-write revokes.)
REVOKE EXECUTE ON FUNCTION public.claim_vault_transcode() FROM PUBLIC, anon, authenticated;
-- verify (only service_role — and postgres — should remain):
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name = 'claim_vault_transcode';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 4 — backfill existing finalized rows (covers the 5 test clips).
-- .webm → needs transcode; anything already .mp4/.m4a (iOS Safari) is playable now.
-- REVIEW WITH A SELECT FIRST (below), then run the UPDATE.
--   preview:
SELECT contributor_name, recording_type, recording_url,
       CASE WHEN recording_url ILIKE '%.webm' THEN 'pending_transcode' ELSE 'not_needed' END AS will_set
FROM public.event_contributions
WHERE status = 'complete' AND transcode_status IS NULL
ORDER BY submitted_at;
--   apply:
UPDATE public.event_contributions
SET transcode_status = CASE WHEN recording_url ILIKE '%.webm' THEN 'pending_transcode' ELSE 'not_needed' END,
    playback_url     = CASE WHEN recording_url ILIKE '%.webm' THEN NULL ELSE recording_url END
WHERE status = 'complete' AND transcode_status IS NULL;
-- verify:
SELECT transcode_status, count(*) FROM public.event_contributions GROUP BY transcode_status;
