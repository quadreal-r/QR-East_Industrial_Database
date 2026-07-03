import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type AdminAction =
  | { action: 'list' }
  | { action: 'create'; email: string; password: string; name: string }
  | { action: 'delete'; userId: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: 'Server misconfigured' }, 500)
  }

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser()

  if (userError || !user?.email) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from('auth_admins')
    .select('email')
    .ilike('email', user.email)
    .maybeSingle()

  if (adminError) {
    return json({ error: adminError.message }, 500)
  }
  if (!adminRow) {
    return json({ error: 'Forbidden' }, 403)
  }

  let payload: AdminAction
  try {
    payload = (await req.json()) as AdminAction
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (payload.action === 'list') {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 })
    if (error) return json({ error: error.message }, 500)

    const users = (data.users ?? []).map((entry) => ({
      id: entry.id,
      email: entry.email ?? '',
      name: typeof entry.user_metadata?.full_name === 'string' ? entry.user_metadata.full_name : '',
      createdAt: entry.created_at,
    }))

    users.sort((a, b) => a.email.localeCompare(b.email))
    return json({ users })
  }

  if (payload.action === 'create') {
    const email = payload.email?.trim().toLowerCase()
    const password = payload.password ?? ''
    const name = payload.name?.trim() ?? ''

    if (!email || !password) {
      return json({ error: 'Email and password are required' }, 400)
    }
    if (password.length < 6) {
      return json({ error: 'Password must be at least 6 characters' }, 400)
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : {},
    })

    if (error) return json({ error: error.message }, 400)

    const created = data.user
    return json({
      user: {
        id: created?.id ?? '',
        email: created?.email ?? email,
        name,
        createdAt: created?.created_at ?? new Date().toISOString(),
      },
    })
  }

  if (payload.action === 'delete') {
    const userId = payload.userId?.trim()
    if (!userId) return json({ error: 'userId is required' }, 400)
    if (userId === user.id) {
      return json({ error: 'You cannot delete your own account here' }, 400)
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
