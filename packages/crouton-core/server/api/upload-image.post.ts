import { useNitroApp } from 'nitropack/runtime'
import { requireServerSession } from '@fyit/crouton-auth/server/utils/useServerAuth'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { DEFAULT_ALLOWED_TYPES } from '../utils/upload-types'

export default defineEventHandler(async (event) => {
  // Auth check - require authenticated user
  const session = await requireServerSession(event)
  const userId = session.user.id
  const activeTeamId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId

  // Files live under their owner's prefix so DELETE can verify ownership
  let prefix = `users/${userId}`
  if (activeTeamId) {
    const { team } = await resolveTeamAndCheckMembership(event)
    prefix = `teams/${team.id}`
  }

  // Get upload constraints from runtime config
  const config = useRuntimeConfig(event)
  const uploadConfig = (config.public as any)?.croutonUpload || {} as Record<string, any>
  const maxSize = uploadConfig.maxSize || '10MB'
  // `[]` must mean "use defaults" — ensureBlob skips the check on an empty list
  const allowedTypes: string[] = uploadConfig.allowedTypes?.length ? uploadConfig.allowedTypes : DEFAULT_ALLOWED_TYPES

  const form = await readFormData(event)
  const file = form.get('image') || form.get('file')

  if (!(file instanceof Blob)) {
    throw createError({
      status: 400,
      statusText: 'File is required and must be a valid file'
    })
  }

  try {
    ensureBlob(file, {
      maxSize,
      types: allowedTypes
    })
  } catch (error: unknown) {
    throw createError({
      status: 400,
      statusText: (error as Error).message || (error as string)
    })
  }

  // File extends Blob and has a name property; use it if available, otherwise generate one
  const fileName = (file as File).name || `upload-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
  const startTime = Date.now()
  const blobObject = await blob.put(fileName, file, {
    addRandomSuffix: true,
    prefix
  }).catch((err: unknown) => {
    throw createError({
      status: 500,
      statusText: `Blob storage error: ${(err as Error).message ?? String(err)}`
    })
  })
  const duration = Date.now() - startTime

  const nitroApp = useNitroApp()
  nitroApp.hooks.callHook('crouton:operation', {
    type: 'asset:uploaded',
    source: 'crouton-assets',
    userId,
    metadata: {
      filename: fileName,
      mimeType: file.type,
      fileSize: file.size,
      pathname: blobObject.pathname,
      duration,
    },
  }).catch(() => {})

  return {
    pathname: blobObject.pathname,
    contentType: file.type,
    size: file.size,
    filename: fileName
  }
})
