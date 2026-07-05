import { supabase } from '@/lib/supabaseClient'

export interface DeleteRtuPictureResult {
  ok: true
  r2Deleted: number
  supabaseDeleted: boolean
  manifestUpdated: boolean
}

type DeleteRtuPictureResponse = DeleteRtuPictureResult | { error: string }

export async function deleteRtuPictureFromCloud(input: {
  buildingAddress: string
  rtuName: string
  fileName: string
}): Promise<DeleteRtuPictureResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.access_token) {
    throw new Error('Sign in to delete pictures from Cloudflare.')
  }

  const { data, error } = await supabase.functions.invoke<DeleteRtuPictureResponse>(
    'delete-rtu-picture',
    { body: input },
  )

  if (error) {
    throw new Error(error.message || 'Cloud picture delete failed')
  }

  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error)
  }

  if (!data || !('ok' in data)) {
    throw new Error('Empty response from picture delete service')
  }

  return data
}
