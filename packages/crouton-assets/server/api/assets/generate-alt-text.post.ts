import { generateText } from 'ai'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { image, mimeType } = await readBody<{ image: string, mimeType: string }>(event)

  if (!image) {
    throw createError({ status: 400, statusText: 'Image data is required' })
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore Optional Nitro auto-import from crouton-ai: unresolved when assets loads alone, resolved when both layers load
  const ai = createAIProvider(event)
  const modelId = ai.getDefaultModel()

  const result = await generateText({
    model: ai.model(modelId),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image,
            mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
          },
          {
            type: 'text',
            text: 'Write a concise, descriptive alt text for this image suitable for web accessibility. Describe what is shown in 1-2 sentences. Return only the alt text with no quotes, labels, or prefixes.'
          }
        ]
      }
    ],
    maxTokens: 150,
    temperature: 0.3
  })

  return { alt: result.text.trim() }
})