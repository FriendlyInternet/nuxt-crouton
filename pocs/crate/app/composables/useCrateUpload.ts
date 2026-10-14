// Add new music (#2237): pick files → skip what crate already has → upload the rest into the inbox.
import type { CrateTrack } from '~/composables/useCrate'

const MAX_BYTES = 100 * 1024 * 1024 // mirrors the server's limit (a Worker request body)

interface CheckResult { hash: string, status: 'new' | 'same-file' | 'same-track', match: string | null }

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Track length from the browser's own decoder; undefined when it can't read the format. */
function durationOf(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (sec?: number) => {
      URL.revokeObjectURL(url)
      resolve(sec && Number.isFinite(sec) ? Math.round(sec) : undefined)
    }
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => done(audio.duration), { once: true })
    audio.addEventListener('error', () => done(), { once: true })
    audio.src = url
  })
}

const errorText = (error: unknown) => (error as { statusMessage?: string }).statusMessage ?? (error as Error).message ?? String(error)

/** One toast line: "2 added to the inbox · 1 already in crate · 1 over 100 MB". */
function summary(added: number, skipped: number, tooBig: number) {
  return [
    added && `${added} added to the inbox`,
    skipped && `${skipped} already in crate`,
    tooBig && `${tooBig} over 100 MB`
  ].filter(Boolean).join(' · ') || 'Nothing to add'
}

export function useCrateUpload(crate: ReturnType<typeof useCrate>) {
  const toast = useToast()
  const progress = ref<{ done: number, total: number, name: string } | null>(null)

  /** Hash each file and ask which ones crate doesn't have yet. */
  async function freshFiles(files: File[]) {
    if (!files.length) return []
    const hashes = await Promise.all(files.map(sha256))
    const checks = await $fetch<CheckResult[]>(crate.api('/uploads/check'), {
      method: 'POST',
      body: { files: files.map((f, i) => ({ hash: hashes[i], fileName: f.name })) }
    })
    return files.map((file, i) => ({ file, hash: hashes[i]! })).filter((_, i) => checks[i]?.status === 'new')
  }

  function putFile(file: File, hash: string, durationSec: number | undefined) {
    return $fetch<CrateTrack>(crate.api(`/uploads/${hash}`), {
      method: 'PUT',
      query: { fileName: file.name, durationSec },
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    })
  }

  /** Upload `files`; returns the tracks that made it into the inbox. */
  async function upload(files: File[]): Promise<CrateTrack[]> {
    if (!files.length || progress.value) return []
    const fits = files.filter(f => f.size <= MAX_BYTES)
    const added: CrateTrack[] = []
    const failed: string[] = []
    progress.value = { done: 0, total: fits.length, name: 'Checking…' }
    try {
      const fresh = await freshFiles(fits)
      progress.value = { done: 0, total: fresh.length, name: '' }
      for (const { file, hash } of fresh) {
        progress.value.name = file.name
        try {
          const track = await putFile(file, hash, await durationOf(file))
          crate.addTrack(track)
          added.push(track)
        }
        catch (error) {
          failed.push(`${file.name}: ${errorText(error)}`)
        }
        progress.value.done++
      }
      toast.add({
        title: summary(added.length, fits.length - fresh.length, files.length - fits.length),
        description: failed.length ? `Failed: ${failed.join('; ')}` : undefined,
        color: failed.length ? 'warning' : 'success'
      })
    }
    catch (error) {
      toast.add({ title: 'Upload failed', description: errorText(error), color: 'error' })
    }
    finally {
      progress.value = null
    }
    return added
  }

  return { upload, progress }
}
