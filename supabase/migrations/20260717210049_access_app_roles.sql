-- Cloudflare Access identities receive one of two application roles.
CREATE TABLE public.app_roles (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email))),
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_roles (email, role)
SELECT lower(trim(email)), 'admin'
FROM public.auth_admins
ON CONFLICT (email) DO UPDATE SET role = 'admin';

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_my_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.app_roles
  WHERE email = lower(coalesce(auth.jwt() ->> 'email', ''))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.get_my_app_role() = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION public.is_app_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_app_admin();
$$;

REVOKE ALL ON FUNCTION public.get_my_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_app_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_editor() TO authenticated;

CREATE POLICY "Admins read app_roles"
  ON public.app_roles FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

CREATE POLICY "Admins insert app_roles"
  ON public.app_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_app_admin());

CREATE POLICY "Admins update app_roles"
  ON public.app_roles FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY "Admins delete app_roles"
  ON public.app_roles FOR DELETE
  TO authenticated
  USING (public.is_app_admin());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'buildings', 'rtus', 'tenants', 'utilities', 'polygons', 'app_settings',
    'rtu_pricing', 'rtu_pictures', 'rtu_documents', 'portfolio_map_views',
    'building_year_budgets', 'rtu_budgets'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Auth write %s" ON public.%I', table_name, table_name);
      EXECUTE format(
        'CREATE POLICY "Admin write %s" ON public.%I FOR ALL TO authenticated USING (public.is_app_editor()) WITH CHECK (public.is_app_editor())',
        table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;
