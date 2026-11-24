import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

// The SFC relies on Nuxt auto-imports (ref, computed, useT)
Object.assign(globalThis, {
  ref,
  computed,
  useT: () => ({ t: (k: string) => k })
})

const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' },
  UIcon: true,
  CroutonImageCropper: true,
  UModal: {
    props: ['title'],
    template: '<div class="modal" :data-title="title"><slot name="content" :close="() => {}" /></div>'
  }
}

async function mountUpload(props: Record<string, any> = {}) {
  const ImageUpload = (await import('../../app/components/ImageUpload.vue')).default
  return mount(ImageUpload, { props, global: { stubs } })
}

describe('ImageUpload', () => {
  // covers: T3
  it('names the upload button when there is no image', async () => {
    const w = await mountUpload()
    const labels = w.findAll('button').map(b => b.attributes('aria-label'))
    expect(labels).toEqual(['image.upload'])
  })

  // covers: T4
  it('names the remove and change buttons when an image is set', async () => {
    const w = await mountUpload({ modelValue: 'blob:x' })
    const labels = w.findAll('button').map(b => b.attributes('aria-label'))
    expect(labels).toEqual(['image.remove', 'image.change'])
  })

  // covers: T5
  it('gives the crop dialog a title', async () => {
    const w = await mountUpload()
    expect(w.find('.modal').attributes('data-title')).toBe('image.cropImage')
  })
})
