-- Viewers may change Cost Center RTU $ Allocation (budget) and notes
-- (replacement_note). All other RTU columns stay admin-only.

CREATE OR REPLACE FUNCTION public.enforce_rtu_viewer_column_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_app_editor() THEN
    RETURN NEW;
  END IF;

  -- updated_at is maintained by rtus_updated_at; ignore it in the compare.
  IF (to_jsonb(NEW) - 'budget' - 'replacement_note' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'budget' - 'replacement_note' - 'updated_at')
  THEN
    RAISE EXCEPTION 'Only admins can change RTU fields other than budget and notes'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_rtu_viewer_column_updates() IS
  'Non-admins may only UPDATE rtus.budget and rtus.replacement_note.';

DROP TRIGGER IF EXISTS rtus_enforce_viewer_column_updates ON public.rtus;
CREATE TRIGGER rtus_enforce_viewer_column_updates
  BEFORE UPDATE ON public.rtus
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rtu_viewer_column_updates();

-- Permissive UPDATE for any signed-in user; the trigger restricts non-admin columns.
DROP POLICY IF EXISTS "Authenticated update rtus cost fields" ON public.rtus;
CREATE POLICY "Authenticated update rtus cost fields"
  ON public.rtus
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
