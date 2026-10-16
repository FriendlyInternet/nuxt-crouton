import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'
import en from '../../../i18n/locales/en.json'

// Stub Vue primitives globally for the composable
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

// useT is auto-imported at runtime; resolve keys against the real English locale
vi.stubGlobal('useT', () => ({
  t: (key: string, params: Record<string, unknown> = {}) => {
    const msg = key.split('.').reduce<any>((node, part) => node?.[part], en)
    return typeof msg === 'string' ? msg.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : key
  }
}))

// Import after mocking
import { useExpandableSlideover } from '../useExpandableSlideover'

describe('useExpandableSlideover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('returns all expected properties', () => {
      const slideover = useExpandableSlideover()

      expect(slideover.isOpen).toBeDefined()
      expect(slideover.isExpanded).toBeDefined()
      expect(slideover.toggleExpand).toBeDefined()
      expect(slideover.expand).toBeDefined()
      expect(slideover.collapse).toBeDefined()
      expect(slideover.open).toBeDefined()
      expect(slideover.close).toBeDefined()
      expect(slideover.slideoverUi).toBeDefined()
      expect(slideover.expandIcon).toBeDefined()
      expect(slideover.expandTooltip).toBeDefined()
    })

    it('initializes with default values', () => {
      const slideover = useExpandableSlideover()

      expect(slideover.isOpen.value).toBe(false)
      expect(slideover.isExpanded.value).toBe(false)
    })

    it('respects defaultExpanded option', () => {
      const slideover = useExpandableSlideover({ defaultExpanded: true })

      expect(slideover.isExpanded.value).toBe(true)
    })
  })

  describe('open()', () => {
    it('opens the slideover', () => {
      const { isOpen, open } = useExpandableSlideover()

      open()

      expect(isOpen.value).toBe(true)
    })

    it('opens in collapsed state by default', () => {
      const { isExpanded, open } = useExpandableSlideover()

      open()

      expect(isExpanded.value).toBe(false)
    })

    it('opens in expanded state when passed true', () => {
      const { isExpanded, open } = useExpandableSlideover()

      open(true)

      expect(isExpanded.value).toBe(true)
    })
  })

  describe('close()', () => {
    it('closes the slideover', () => {
      const { isOpen, open, close } = useExpandableSlideover()

      open()
      close()

      expect(isOpen.value).toBe(false)
    })

    it('resets expanded state to default after closing', () => {
      const { isExpanded, open, close } = useExpandableSlideover()

      open(true)
      expect(isExpanded.value).toBe(true)

      close()
      vi.advanceTimersByTime(300)

      expect(isExpanded.value).toBe(false)
    })

    it('respects defaultExpanded when resetting on close', () => {
      const { isExpanded, open, close } = useExpandableSlideover({ defaultExpanded: true })

      open()
      close()
      vi.advanceTimersByTime(300)

      expect(isExpanded.value).toBe(true)
    })
  })

  describe('expand()', () => {
    it('expands the slideover to fullscreen', () => {
      const { isExpanded, expand } = useExpandableSlideover()

      expand()

      expect(isExpanded.value).toBe(true)
    })
  })

  describe('collapse()', () => {
    it('collapses the slideover to sidebar', () => {
      const { isExpanded, expand, collapse } = useExpandableSlideover()

      expand()
      collapse()

      expect(isExpanded.value).toBe(false)
    })
  })

  describe('toggleExpand()', () => {
    it('toggles from collapsed to expanded', () => {
      const { isExpanded, toggleExpand } = useExpandableSlideover()

      toggleExpand()

      expect(isExpanded.value).toBe(true)
    })

    it('toggles from expanded to collapsed', () => {
      const { isExpanded, expand, toggleExpand } = useExpandableSlideover()

      expand()
      toggleExpand()

      expect(isExpanded.value).toBe(false)
    })

    it('closes on expand when closeOnExpand is true', () => {
      const { isOpen, open, toggleExpand } = useExpandableSlideover({ closeOnExpand: true })

      open()
      toggleExpand()
      vi.advanceTimersByTime(300)

      expect(isOpen.value).toBe(false)
    })

    it('does not close on expand when closeOnExpand is false', () => {
      const { isOpen, open, toggleExpand } = useExpandableSlideover({ closeOnExpand: false })

      open()
      toggleExpand()
      vi.advanceTimersByTime(300)

      expect(isOpen.value).toBe(true)
    })
  })

  describe('expandIcon', () => {
    it('returns maximize icon when collapsed', () => {
      const { expandIcon } = useExpandableSlideover()

      expect(expandIcon.value).toBe('i-lucide-maximize-2')
    })

    it('returns minimize icon when expanded', () => {
      const { expandIcon, expand } = useExpandableSlideover()

      expand()

      expect(expandIcon.value).toBe('i-lucide-minimize-2')
    })
  })

  describe('expandTooltip', () => {
    it('returns expand text when collapsed', () => {
      const { expandTooltip } = useExpandableSlideover()

      expect(expandTooltip.value).toBe('Expand to fullscreen')
    })

    it('returns collapse text when expanded', () => {
      const { expandTooltip, expand } = useExpandableSlideover()

      expand()

      expect(expandTooltip.value).toBe('Collapse to sidebar')
    })
  })

  describe('slideoverUi', () => {
    it('returns sidebar mode config when collapsed', () => {
      const { slideoverUi } = useExpandableSlideover()

      expect(slideoverUi.value.content).toContain('max-w-xl')
      expect(slideoverUi.value.overlay).toContain('transition-opacity')
    })

    it('returns fullscreen mode config when expanded', () => {
      const { slideoverUi, expand } = useExpandableSlideover()

      expand()

      expect(slideoverUi.value.content).toContain('max-w-none')
      expect(slideoverUi.value.content).toContain('w-full')
      expect(slideoverUi.value.overlay).toContain('backdrop-blur-sm')
    })

    it('includes transition classes in content', () => {
      const { slideoverUi } = useExpandableSlideover()

      expect(slideoverUi.value.content).toContain('transition-')
      expect(slideoverUi.value.content).toContain('duration-300')
    })
  })

  describe('maxWidth option', () => {
    it('uses sm width when maxWidth is sm', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: 'sm' })

      expect(slideoverUi.value.content).toContain('max-w-sm')
    })

    it('uses md width when maxWidth is md', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: 'md' })

      expect(slideoverUi.value.content).toContain('max-w-md')
    })

    it('uses lg width when maxWidth is lg', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: 'lg' })

      expect(slideoverUi.value.content).toContain('max-w-lg')
    })

    it('uses xl width when maxWidth is xl', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: 'xl' })

      expect(slideoverUi.value.content).toContain('max-w-xl')
    })

    it('uses 2xl width when maxWidth is 2xl', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: '2xl' })

      expect(slideoverUi.value.content).toContain('max-w-2xl')
    })

    it('uses 4xl width when maxWidth is 4xl', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: '4xl' })

      expect(slideoverUi.value.content).toContain('max-w-4xl')
    })

    it('uses 7xl width when maxWidth is 7xl', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: '7xl' })

      expect(slideoverUi.value.content).toContain('max-w-7xl')
    })

    it('uses full width when maxWidth is full', () => {
      const { slideoverUi } = useExpandableSlideover({ maxWidth: 'full' })

      expect(slideoverUi.value.content).toContain('w-full')
      expect(slideoverUi.value.content).not.toContain('max-w-')
    })
  })

  describe('expanded mode slideoverUi', () => {
    it('includes wrapper transitions', () => {
      const { slideoverUi, expand } = useExpandableSlideover()

      expand()

      expect(slideoverUi.value.wrapper).toContain('transition-all')
      expect(slideoverUi.value.wrapper).toContain('w-full')
      expect(slideoverUi.value.wrapper).toContain('h-full')
    })

    it('includes body styling', () => {
      const { slideoverUi, expand } = useExpandableSlideover()

      expand()

      expect(slideoverUi.value.body).toContain('flex-1')
      expect(slideoverUi.value.body).toContain('overflow-y-auto')
      expect(slideoverUi.value.body).toContain('p-6')
    })

    it('includes header styling', () => {
      const { slideoverUi, expand } = useExpandableSlideover()

      expand()

      expect(slideoverUi.value.header).toContain('border-b')
      expect(slideoverUi.value.header).toContain('min-h-16')
    })
  })
})
