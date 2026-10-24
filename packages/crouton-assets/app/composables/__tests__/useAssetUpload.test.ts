import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'

// Mock team context
let mockTeamId: string | null = 'test-team'
vi.stubGlobal('useTeamContext', () => ({
  getTeamId: () => mockTeamId
}))

// Mock $fetch
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

// Mock Vue reactivity
vi.stubGlobal('ref', ref)
vi.stubGlobal('readonly', readonly)

// Mock collection mutation: posts like the real one and records the refresh
const mockInvalidate = vi.fn()
vi.stubGlobal('useCollectionMutation', (name: string) => ({
  create: async (data: any) => {
    const apiPath = name === 'croutonAssets' ? 'assets' : name
    const result = await mockFetch(`/api/teams/${mockTeamId}/${apiPath}`, { method: 'POST', body: data })
    mockInvalidate(name)
    return result
  }
}))

// Import composable after mocking
import { useAssetUpload } from '../useAssetUpload'
import type { UploadAssetResult } from '../useAssetUpload'

describe('useAssetUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTeamId = 'test-team'
    mockFetch.mockReset()
  })

  describe('composable return value', () => {
    it('returns uploadAsset, uploadAssets, uploading, and error', () => {
      const result = useAssetUpload()

      expect(result).toHaveProperty('uploadAsset')
      expect(result).toHaveProperty('uploadAssets')
      expect(result).toHaveProperty('uploading')
      expect(result).toHaveProperty('error')
    })

    it('returns uploading as false initially', () => {
      const { uploading } = useAssetUpload()

      expect(uploading.value).toBe(false)
    })

    it('returns error as null initially', () => {
      const { error } = useAssetUpload()

      expect(error.value).toBe(null)
    })
  })

  describe('uploadAsset', () => {
    const mockFile = new File(['test content'], 'test-image.png', {
      type: 'image/png'
    })

    const mockUploadResponse = {
      pathname: 'uploads/test-image-abc123.png',
      contentType: 'image/png',
      size: 12,
      filename: 'test-image.png'
    }

    const mockAssetResponse: UploadAssetResult = {
      id: 'asset-123',
      pathname: 'uploads/test-image-abc123.png',
      filename: 'test-image.png',
      contentType: 'image/png',
      size: 12,
      alt: 'Test image'
    }

    it('uploads file to blob storage first', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse) // blob upload
        .mockResolvedValueOnce(mockAssetResponse) // asset record

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile)

      expect(mockFetch).toHaveBeenCalledWith('/api/upload-image', {
        method: 'POST',
        body: expect.any(FormData)
      })
    })

    it('creates asset record after blob upload', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile, { alt: 'Test image' })

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/test-team/assets', {
        method: 'POST',
        body: expect.objectContaining({
          filename: 'test-image.png',
          pathname: 'uploads/test-image-abc123.png',
          contentType: 'image/png',
          size: 12,
          alt: 'Test image'
        })
      })
    })

    it('refreshes the collection after creating the record', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile)

      expect(mockInvalidate).toHaveBeenCalledWith('croutonAssets')
    })

    it('uses custom filename from metadata', async () => {
      mockFetch
        .mockResolvedValueOnce({ ...mockUploadResponse, pathname: 'uploads/custom-abc123.png' })
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile, { filename: 'custom-name.png' })

      expect(mockFetch).toHaveBeenLastCalledWith('/api/teams/test-team/assets', {
        method: 'POST',
        body: expect.objectContaining({
          filename: 'custom-name.png'
        })
      })
    })

    it('uses custom collection name', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile, {}, 'media')

      expect(mockFetch).toHaveBeenLastCalledWith('/api/teams/test-team/media', expect.any(Object))
    })

    it('returns the created asset record', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      const result = await uploadAsset(mockFile)

      expect(result).toEqual(mockAssetResponse)
    })

    it('sets uploading to true during upload', async () => {
      let uploadingDuringCall = false

      mockFetch.mockImplementation(async () => {
        // Capture uploading state during the call
        return new Promise(resolve => {
          setTimeout(() => resolve(mockUploadResponse), 10)
        })
      })

      const { uploadAsset, uploading } = useAssetUpload()

      const uploadPromise = uploadAsset(mockFile)
      // Check uploading state immediately after starting
      uploadingDuringCall = uploading.value

      // Setup second mock for asset record
      mockFetch.mockResolvedValueOnce(mockAssetResponse)

      await uploadPromise.catch(() => {}) // May fail due to missing second response

      expect(uploadingDuringCall).toBe(true)
    })

    it('sets uploading to false after successful upload', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset, uploading } = useAssetUpload()
      await uploadAsset(mockFile)

      expect(uploading.value).toBe(false)
    })

    it('throws error when team context not available', async () => {
      mockTeamId = null

      mockFetch.mockResolvedValueOnce(mockUploadResponse)

      const { uploadAsset } = useAssetUpload()

      await expect(uploadAsset(mockFile)).rejects.toThrow('Team context not available')
    })

    it('sets error when upload fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { uploadAsset, error } = useAssetUpload()

      await expect(uploadAsset(mockFile)).rejects.toThrow('Network error')
      expect(error.value).toBeInstanceOf(Error)
      expect(error.value?.message).toBe('Network error')
    })

    it('sets uploading to false after failed upload', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { uploadAsset, uploading } = useAssetUpload()

      await uploadAsset(mockFile).catch(() => {})

      expect(uploading.value).toBe(false)
    })

    it('wraps non-Error exceptions in Error', async () => {
      mockFetch.mockRejectedValueOnce('string error')

      const { uploadAsset, error } = useAssetUpload()

      await uploadAsset(mockFile).catch(() => {})

      expect(error.value).toBeInstanceOf(Error)
      expect(error.value?.message).toBe('Upload failed')
    })

    it('clears previous error on new upload', async () => {
      // First upload fails
      mockFetch.mockRejectedValueOnce(new Error('First error'))

      const { uploadAsset, error } = useAssetUpload()
      await uploadAsset(mockFile).catch(() => {})

      expect(error.value?.message).toBe('First error')

      // Second upload succeeds
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      await uploadAsset(mockFile)

      expect(error.value).toBe(null)
    })

    it('defaults alt to empty string when not provided', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile)

      expect(mockFetch).toHaveBeenLastCalledWith('/api/teams/test-team/assets', {
        method: 'POST',
        body: expect.objectContaining({
          alt: ''
        })
      })
    })

    it('includes uploadedAt date in asset record', async () => {
      mockFetch
        .mockResolvedValueOnce(mockUploadResponse)
        .mockResolvedValueOnce(mockAssetResponse)

      const { uploadAsset } = useAssetUpload()
      await uploadAsset(mockFile)

      expect(mockFetch).toHaveBeenLastCalledWith('/api/teams/test-team/assets', {
        method: 'POST',
        body: expect.objectContaining({
          uploadedAt: expect.any(Date)
        })
      })
    })
  })

  describe('uploadAssets', () => {
    const mockFiles = [
      new File(['content1'], 'image1.png', { type: 'image/png' }),
      new File(['content2'], 'image2.png', { type: 'image/png' }),
      new File(['content3'], 'image3.png', { type: 'image/png' })
    ]

    const mockAssetResponses: UploadAssetResult[] = [
      { id: 'asset-1', pathname: 'uploads/image1.png', filename: 'image1.png', contentType: 'image/png', size: 8 },
      { id: 'asset-2', pathname: 'uploads/image2.png', filename: 'image2.png', contentType: 'image/png', size: 8 },
      { id: 'asset-3', pathname: 'uploads/image3.png', filename: 'image3.png', contentType: 'image/png', size: 8 }
    ]

    it('uploads multiple files in parallel', async () => {
      // Each file needs blob upload + asset record
      mockFetch
        .mockResolvedValueOnce({ pathname: 'uploads/image1.png', contentType: 'image/png', size: 8, filename: 'image1.png' })
        .mockResolvedValueOnce({ pathname: 'uploads/image2.png', contentType: 'image/png', size: 8, filename: 'image2.png' })
        .mockResolvedValueOnce({ pathname: 'uploads/image3.png', contentType: 'image/png', size: 8, filename: 'image3.png' })
        .mockResolvedValueOnce(mockAssetResponses[0])
        .mockResolvedValueOnce(mockAssetResponses[1])
        .mockResolvedValueOnce(mockAssetResponses[2])

      const { uploadAssets } = useAssetUpload()
      const results = await uploadAssets(mockFiles)

      expect(results).toHaveLength(3)
    })

    it('returns all created asset records', async () => {
      // Mock based on URL pattern since parallel execution order is unpredictable
      mockFetch.mockImplementation(async (url: string) => {
        if (url === '/api/upload-image') {
          return { pathname: 'uploads/image.png', contentType: 'image/png', size: 8, filename: 'image.png' }
        }
        if (url.includes('/api/teams/')) {
          return { id: 'asset-id', pathname: 'uploads/image.png', filename: 'image.png', contentType: 'image/png', size: 8 }
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const { uploadAssets } = useAssetUpload()
      const results = await uploadAssets(mockFiles.slice(0, 2))

      expect(results).toHaveLength(2)
      results.forEach(result => {
        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('pathname')
      })
    })

    it('applies metadata to all files', async () => {
      mockFetch
        .mockResolvedValueOnce({ pathname: 'uploads/image1.png', contentType: 'image/png', size: 8, filename: 'image1.png' })
        .mockResolvedValueOnce(mockAssetResponses[0])
        .mockResolvedValueOnce({ pathname: 'uploads/image2.png', contentType: 'image/png', size: 8, filename: 'image2.png' })
        .mockResolvedValueOnce(mockAssetResponses[1])

      const { uploadAssets } = useAssetUpload()
      await uploadAssets(mockFiles.slice(0, 2), { alt: 'Batch upload' })

      // Check both asset record calls have the alt text
      const assetCalls = mockFetch.mock.calls.filter(call =>
        call[0].includes('/api/teams/')
      )
      expect(assetCalls).toHaveLength(2)
      assetCalls.forEach(call => {
        expect(call[1].body.alt).toBe('Batch upload')
      })
    })

    it('uses custom collection for all files', async () => {
      mockFetch
        .mockResolvedValueOnce({ pathname: 'uploads/image1.png', contentType: 'image/png', size: 8, filename: 'image1.png' })
        .mockResolvedValueOnce(mockAssetResponses[0])

      const { uploadAssets } = useAssetUpload()
      await uploadAssets([mockFiles[0]!], {}, 'documents')

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/test-team/documents', expect.any(Object))
    })

    it('handles empty files array', async () => {
      const { uploadAssets } = useAssetUpload()
      const results = await uploadAssets([])

      expect(results).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects if any upload fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ pathname: 'uploads/image1.png', contentType: 'image/png', size: 8, filename: 'image1.png' })
        .mockResolvedValueOnce(mockAssetResponses[0])
        .mockRejectedValueOnce(new Error('Upload failed'))

      const { uploadAssets } = useAssetUpload()

      await expect(uploadAssets(mockFiles.slice(0, 2))).rejects.toThrow()
    })
  })
})
