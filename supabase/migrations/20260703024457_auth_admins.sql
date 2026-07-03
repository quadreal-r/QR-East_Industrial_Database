-- App administrators who can manage Supabase Auth users from Settings.
-- Bootstrap: INSERT INTO auth_admins (email) VALUES ('you@example.com');

CREATE TABLE auth_admins (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read auth_admins"
  ON auth_admins FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth_admins
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

REVOKE ALL ON FUNCTION is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_app_admin() TO authenticated;
