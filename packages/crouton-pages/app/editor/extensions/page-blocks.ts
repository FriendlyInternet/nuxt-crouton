/**
 * Page Blocks Extension Bundle
 *
 * Combines all block extensions into a single configurable extension.
 * Use this to add block editing capabilities to any TipTap editor.
 */

import { Extension } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'
import { blockSizeAttribute, blockVisibilityAttribute } from './block-utils'
import { HeroBlock } from './hero-block'
import { SectionBlock } from './section-block'
import { CTABlock } from './cta-block'
import { CardGridBlock } from './card-grid-block'
import { SeparatorBlock } from './separator-block'
import { CollectionBlock } from './collection-block'
import { FaqBlock } from './faq-block'
import { TwoColumnBlock } from './two-column-block'
import { EmbedBlock } from './embed-block'
import { ImageBlock } from './image-block'
import { LogoBlock } from './logo-block'
import { VideoBlock } from './video-block'
import { FileBlock } from './file-block'
import { ButtonRowBlock } from './button-row-block'
import { StatsBlock } from './stats-block'
import { GalleryBlock } from './gallery-block'
import { ContactBlock } from './contact-block'
import { MailingBlock } from './mailing-block'
import { QrCodeBlock } from './qr-code-block'
import { PaneBlock } from './pane-block'
import { BlockCommands } from './block-commands'
import { createAddonBlockExtension } from './addon-block-factory'

export interface PageBlocksOptions {
  /**
   * Enable specific block types (all enabled by default)
   */
  blocks?: {
    hero?: boolean
    section?: boolean
    cta?: boolean
    cardGrid?: boolean
    separator?: boolean
    collection?: boolean
    faq?: boolean
    twoColumn?: boolean
    embed?: boolean
    image?: boolean
    logo?: boolean
    video?: boolean
    file?: boolean
    buttonRow?: boolean
    stats?: boolean
    gallery?: boolean
    contact?: boolean
    mailing?: boolean
    qrCode?: boolean
    pane?: boolean
  }
  /**
   * Addon block definitions from external packages (registered via croutonBlocks in app.config.ts)
   */
  addonBlocks?: CroutonBlockDefinition[]
  /**
   * Enable slash commands for block insertion
   */
  enableSlashCommands?: boolean
  /**
   * Custom suggestion options for slash commands
   */
  suggestionOptions?: Record<string, unknown>
}

export const PageBlocks = Extension.create<PageBlocksOptions>({
  name: 'pageBlocks',

  addOptions() {
    return {
      blocks: {
        hero: true,
        section: true,
        cta: true,
        cardGrid: true,
        separator: true,
        collection: true,
        faq: true,
        twoColumn: true,
        embed: true,
        image: true,
        logo: true,
        video: true,
        file: true,
        buttonRow: true,
        stats: true,
        gallery: true,
        contact: true,
        mailing: true,
        qrCode: true,
        pane: true
      },
      addonBlocks: [],
      enableSlashCommands: true,
      suggestionOptions: {}
    }
  },

  addGlobalAttributes() {
    // All core block node types
    const coreBlockTypes = [
      'heroBlock', 'sectionBlock', 'ctaBlock', 'cardGridBlock',
      'separatorBlock', 'collectionBlock', 'faqBlock', 'twoColumnBlock',
      'embedBlock', 'imageBlock', 'logoBlock', 'videoBlock',
      'fileBlock', 'buttonRowBlock', 'richTextBlock',
      'statsBlock', 'galleryBlock', 'contactBlock', 'mailingBlock',
      'qrCodeBlock', 'paneBlock'
    ]

    // Addon block types from config
    const addonBlockTypes = (this.options.addonBlocks || []).map(def => def.type)

    return [
      {
        types: [...coreBlockTypes, ...addonBlockTypes],
        attributes: { ...blockSizeAttribute, ...blockVisibilityAttribute }
      }
    ]
  },

  addExtensions() {
    const extensions: any[] = []
    const { blocks, addonBlocks, enableSlashCommands, suggestionOptions } = this.options

    // Add Highlight mark extension (single-color mode)
    extensions.push(Highlight.configure({ multicolor: false }))

    // Add enabled core block extensions
    if (blocks?.hero !== false) {
      extensions.push(HeroBlock)
    }
    if (blocks?.section !== false) {
      extensions.push(SectionBlock)
    }
    if (blocks?.cta !== false) {
      extensions.push(CTABlock)
    }
    if (blocks?.cardGrid !== false) {
      extensions.push(CardGridBlock)
    }
    if (blocks?.separator !== false) {
      extensions.push(SeparatorBlock)
    }
    if (blocks?.collection !== false) {
      extensions.push(CollectionBlock)
    }
    if (blocks?.faq !== false) {
      extensions.push(FaqBlock)
    }
    if (blocks?.twoColumn !== false) {
      extensions.push(TwoColumnBlock)
    }
    if (blocks?.embed !== false) {
      extensions.push(EmbedBlock)
    }
    if (blocks?.image !== false) {
      extensions.push(ImageBlock)
    }
    if (blocks?.logo !== false) {
      extensions.push(LogoBlock)
    }
    if (blocks?.video !== false) {
      extensions.push(VideoBlock)
    }
    if (blocks?.file !== false) {
      extensions.push(FileBlock)
    }
    if (blocks?.buttonRow !== false) {
      extensions.push(ButtonRowBlock)
    }
    if (blocks?.stats !== false) {
      extensions.push(StatsBlock)
    }
    if (blocks?.gallery !== false) {
      extensions.push(GalleryBlock)
    }
    if (blocks?.contact !== false) {
      extensions.push(ContactBlock)
    }
    if (blocks?.mailing !== false) {
      extensions.push(MailingBlock)
    }
    if (blocks?.qrCode !== false) {
      extensions.push(QrCodeBlock)
    }
    if (blocks?.pane !== false) {
      extensions.push(PaneBlock)
    }

    // Add addon block extensions (from croutonBlocks in app.config.ts)
    if (addonBlocks?.length) {
      for (const def of addonBlocks) {
        extensions.push(createAddonBlockExtension(def))
      }
    }

    // Add slash commands if enabled
    if (enableSlashCommands) {
      extensions.push(BlockCommands.configure({
        suggestion: suggestionOptions
      }))
    }

    return extensions
  }
})

// Re-export individual extensions for granular use
export { HeroBlock } from './hero-block'
export { SectionBlock } from './section-block'
export { CTABlock } from './cta-block'
export { CardGridBlock } from './card-grid-block'
export { SeparatorBlock } from './separator-block'
export { CollectionBlock } from './collection-block'
export { FaqBlock } from './faq-block'
export { TwoColumnBlock } from './two-column-block'
export { EmbedBlock } from './embed-block'
export { ImageBlock } from './image-block'
export { LogoBlock } from './logo-block'
export { VideoBlock } from './video-block'
export { FileBlock } from './file-block'
export { ButtonRowBlock } from './button-row-block'
export { StatsBlock } from './stats-block'
export { GalleryBlock } from './gallery-block'
export { ContactBlock } from './contact-block'
export { MailingBlock } from './mailing-block'
export { QrCodeBlock } from './qr-code-block'
export { PaneBlock } from './pane-block'
export { BlockCommands, getBlockCommandItems, getBlockCommandsByCategory } from './block-commands'
export { createAddonBlockExtension } from './addon-block-factory'

// Export types
export type { HeroBlockOptions } from './hero-block'
export type { SectionBlockOptions } from './section-block'
export type { CTABlockOptions } from './cta-block'
export type { CardGridBlockOptions } from './card-grid-block'
export type { SeparatorBlockOptions } from './separator-block'
export type { CollectionBlockOptions } from './collection-block'
export type { FaqBlockOptions } from './faq-block'
export type { TwoColumnBlockOptions } from './two-column-block'
export type { EmbedBlockOptions } from './embed-block'
export type { ImageBlockOptions } from './image-block'
export type { LogoBlockOptions } from './logo-block'
export type { VideoBlockOptions } from './video-block'
export type { FileBlockOptions } from './file-block'
export type { ButtonRowBlockOptions } from './button-row-block'
export type { StatsBlockOptions } from './stats-block'
export type { GalleryBlockOptions } from './gallery-block'
export type { ContactBlockOptions } from './contact-block'
export type { MailingBlockOptions } from './mailing-block'
export type { QrCodeBlockOptions } from './qr-code-block'
export type { PaneBlockOptions } from './pane-block'
export type { BlockCommandsOptions, BlockCommandItem } from './block-commands'

export default PageBlocks
