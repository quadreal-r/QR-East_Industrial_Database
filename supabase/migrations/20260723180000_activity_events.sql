-- Silent usage telemetry for admin activity digest (map app)
CREATE TABLE public.activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(trim(email))),
  event_type text NOT NULL,
  resource_key text,
  duration_ms integer,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_events_created ON public.activity_events (created_at DESC);
CREATE INDEX idx_activity_events_email_created ON public.activity_events (email, created_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users may insert only their own events (email must match JWT).
CREATE POLICY "Users insert own activity_events"
  ON public.activity_events FOR INSERT
  TO authenticated
  WITH CHECK (
    email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Admins may read the full activity log.
CREATE POLICY "Admins read activity_events"
  ON public.activity_events FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

GRANT SELECT, INSERT ON public.activity_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE activity_events_id_seq TO authenticated;
