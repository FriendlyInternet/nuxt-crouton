import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

// The SFC relies on Nuxt auto-imports (ref, computed, useT, useImageCrop).
// useImageCrop is stubbed so cropperjs is never loaded.
Object.assign(globalThis, {
  ref,
  computed,
  useT: () => ({ t: (k: string) => k }),
  useImageCrop: () => ({
    setAspectRatio: vi.fn(),
    rotate: vi.fn(),
    zoom: vi.fn(),
    reset: vi.fn(),
    getCroppedFile: vi.fn(),
    ASPECT_RATIOS: { 'free': undefined, '1:1': 1 }
  })
})

const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' },
  USelect: { inheritAttrs: false, template: '<select v-bind="$attrs"></select>' },
  UIcon: true
}

async function mountCropper() {
  const ImageCropper = (await import('../../app/components/ImageCropper.vue')).default
  return mount(ImageCropper, {
    props: { file: new File(['x'], 'a.png', { type: 'image/png' }), circular: false },
    global: { stubs }
  })
}

describe('ImageCropper', () => {
  // covers: T1
  it('gives every button an accessible name, and labels the five icon buttons', async () => {
    const w = await mountCropper()
    const buttons = w.findAll('button')
    for (const b of buttons) {
      const name = (b.attributes('aria-label') || b.text()).trim()
      expect(name).not.toBe('')
    }
    const labels = buttons.map(b => b.attributes('aria-label')).filter(Boolean)
    expect(labels).toEqual([
      'image.rotateLeft',
      'image.rotateRight',
      'image.zoomOut',
      'image.zoomIn',
      'image.reset'
    ])
  })

  // covers: T2
  it('labels the shape select', async () => {
    const w = await mountCropper()
    expect(w.find('select').attributes('aria-label')).toBe('image.aspectRatio')
  })
})
