import { blob, ensureBlob } from 'hub:blob'

export default defineEventHandler(async (event) => {
  await requirePublicToken(event)

  const form = await readFormData(event)
  const file = form.get('file') || form.get('image')

  if (!(file instanceof Blob)) {
    throw createError({ status: 400, statusText: 'File is required' })
  }

  try {
    ensureBlob(file, {
      maxSize: '16MB',
      types: [
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
        'application/pdf',
      ],
    })
  }
  catch (error: unknown) {
    throw createError({
      status: 400,
      statusText: (error as Error).message || String(error),
    })
  }

  const fileName = (file as File).name || `upload-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
  const blobObject = await blob.put(fileName, file, { addRandomSuffix: true }).catch((err: unknown) => {
    throw createError({
      status: 500,
      statusText: `Blob storage error: ${(err as Error).message ?? String(err)}`,
    })
  })

  return {
    pathname: blobObject.pathname,
    contentType: file.type,
    size: file.size,
    filename: fileName,
  }
})
