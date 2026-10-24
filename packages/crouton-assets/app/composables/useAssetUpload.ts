export interface AssetMetadata {
  alt?: string
  filename?: string
  translations?: Record<string, { alt?: string }>
}

export interface UploadResponse {
  pathname: string
  contentType: string
  size: number
  filename: string
}

export interface UploadAssetResult {
  id: string
  pathname: string
  filename: string
  contentType: string
  size: number
  alt?: string
}

export const useAssetUpload = () => {
  const { getTeamId } = useTeamContext()
  const uploading = ref(false)
  const error = ref<Error | null>(null)
  const progress = ref(0)

  /**
   * Upload a file to blob storage and create an asset record
   * @param file - The file to upload
   * @param metadata - Optional metadata (alt text, custom filename)
   * @param collection - Collection name (defaults to 'assets')
   * @returns The created asset record
   */
  const uploadAsset = async (
    file: File,
    metadata: AssetMetadata = {},
    collection?: string
  ): Promise<UploadAssetResult> => {
    // Create through the collection mutation so every list showing this
    // collection refetches; a raw $fetch left the media library stale.
    // Resolved before the first await, while the Nuxt context is still set.
    const { create } = useCollectionMutation(collection || 'croutonAssets')
    uploading.value = true
    error.value = null
    progress.value = 0

    try {
      // Step 1: Upload file to blob storage
      const formData = new FormData()
      formData.append('file', file)

      const uploadResult = await $fetch<UploadResponse>('/api/upload-image', {
        method: 'POST',
        body: formData
      })

      progress.value = 50

      // Step 2: Create asset record in database
      const teamId = getTeamId()
      if (!teamId) {
        throw new Error('Team context not available')
      }

      const asset: UploadAssetResult = await create({
        filename: metadata.filename || file.name,
        pathname: uploadResult.pathname,
        contentType: uploadResult.contentType,
        size: uploadResult.size,
        alt: metadata.alt || '',
        ...(metadata.translations && Object.keys(metadata.translations).length > 0 && { translations: metadata.translations }),
        uploadedAt: new Date()
      })

      progress.value = 100

      return asset
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Upload failed')
      throw error.value
    } finally {
      uploading.value = false
    }
  }

  /**
   * Upload multiple files in parallel
   * @param files - Array of files to upload
   * @param metadata - Metadata to apply to all files
   * @param collection - Collection name (defaults to 'assets')
   * @returns Array of created asset records
   */
  const uploadAssets = async (
    files: File[],
    metadata: AssetMetadata = {},
    collection?: string
  ): Promise<UploadAssetResult[]> => {
    const uploads = files.map(file => uploadAsset(file, metadata, collection))
    return Promise.all(uploads)
  }

  /**
   * Delete a file from blob storage
   * @param pathname - The blob pathname to delete
   */
  const deleteAssetFile = async (pathname: string): Promise<void> => {
    await $fetch('/api/upload-image', {
      method: 'DELETE',
      body: { pathname }
    })
  }

  return {
    uploadAsset,
    uploadAssets,
    deleteAssetFile,
    uploading: readonly(uploading),
    error: readonly(error),
    progress: readonly(progress)
  }
}
