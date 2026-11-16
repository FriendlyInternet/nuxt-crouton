import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-ai',
  name: 'AI Integration',
  description: 'AI integration with Anthropic Claude and OpenAI',
  icon: 'i-lucide-brain',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app has AI/LLM features or chat',
  dependencies: [],
  provides: {
    composables: ['useChat', 'createAIProvider'],
    components: [
      { name: 'AIPageGenerator', description: 'Modal that generates page content with AI for one or more locales' },
      { name: 'AITranslateButton', description: 'Translate button that calls the AI translation API and emits the result' },
    ],
  },
})
