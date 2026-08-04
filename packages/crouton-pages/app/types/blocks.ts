/**
 * Page Block Types
 *
 * Type definitions for the block-based page editor.
 * Blocks are stored as JSON in the content field and rendered
 * using Nuxt UI page components.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

// ============================================================================
// Base Types
// ============================================================================

/** Core block types built into crouton-pages. Addon blocks use string types via CroutonBlockDefinition. */
export type BlockType =
  | 'heroBlock'
  | 'sectionBlock'
  | 'ctaBlock'
  | 'cardGridBlock'
  | 'separatorBlock'
  | 'richTextBlock'
  | 'collectionBlock'
  | 'faqBlock'
  | 'twoColumnBlock'
  | 'embedBlock'
  | 'imageBlock'
  | 'logoBlock'
  | 'videoBlock'
  | 'fileBlock'
  | 'buttonRowBlock'
  | 'statsBlock'
  | 'galleryBlock'
  | 'contactBlock'
  | 'mailingBlock'
  | 'qrCodeBlock'
  | 'paneBlock'

export type Orientation = 'vertical' | 'horizontal'

/** Block size presets controlling the wrapper width on the rendered page */
export type BlockSize = 'default' | 'narrow' | 'wide' | 'full'

/** Aspect ratio presets for image cropping (mirrors AspectRatioPreset from crouton-core) */
export type BlockImageCropAspectRatio = 'free' | '1:1' | '16:9' | '4:3' | '3:2'

export type ButtonColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'neutral'

export type ButtonVariant =
  | 'solid'
  | 'outline'
  | 'soft'
  | 'subtle'
  | 'ghost'
  | 'link'

export type CTAVariant =
  | 'outline'
  | 'solid'
  | 'soft'
  | 'subtle'
  | 'naked'

// ============================================================================
// Shared Sub-Types
// ============================================================================

export interface BlockLink {
  label: string
  to?: string
  color?: ButtonColor
  variant?: ButtonVariant
  icon?: string
  external?: boolean
}

export interface BlockFeature {
  title: string
  description?: string
  icon?: string
}

export interface BlockCard {
  title: string
  description?: string
  icon?: string
  to?: string
  highlight?: boolean
  highlightColor?: ButtonColor
}

// ============================================================================
// Block Attribute Types
// ============================================================================

export interface HeroBlockAttrs {
  headline?: string
  title: string
  description?: string
  orientation?: Orientation
  reverse?: boolean
  links?: BlockLink[]
  image?: string
  imageAlt?: string
}

export interface SectionBlockAttrs {
  headline?: string
  icon?: string
  title: string
  description?: string
  orientation?: Orientation
  reverse?: boolean
  links?: BlockLink[]
  features?: BlockFeature[]
}

export interface CTABlockAttrs {
  title: string
  description?: string
  orientation?: Orientation
  reverse?: boolean
  variant?: CTAVariant
  links?: BlockLink[]
}

export interface CardGridBlockAttrs {
  headline?: string
  title?: string
  description?: string
  columns?: 2 | 3 | 4
  cards: BlockCard[]
}

export interface SeparatorBlockAttrs {
  label?: string
  icon?: string
  type?: 'solid' | 'dashed' | 'dotted'
}

export interface RichTextBlockAttrs {
  content: string
}

export type CollectionLayout = 'table' | 'list' | 'grid' | 'cards'

export interface FaqItem {
  question: string
  answer: string
}

export interface FaqBlockAttrs {
  headline?: string
  title?: string
  description?: string
  items: FaqItem[]
  allowMultiple?: boolean
}

export interface TwoColumnBlockAttrs {
  split?: '1/2' | '1/3' | '2/3'
  leftTitle?: string
  leftDescription?: string
  leftImage?: string
  leftImageAlt?: string
  leftLinks?: BlockLink[]
  rightTitle?: string
  rightDescription?: string
  rightImage?: string
  rightImageAlt?: string
  rightLinks?: BlockLink[]
}

export interface CollectionBlockAttrs {
  /** Collection name from registry (e.g., 'blogPosts', 'products') */
  collection: string
  /** Optional title to display above the collection */
  title?: string
  /** Layout to render the collection in */
  layout: CollectionLayout
  /** Number of items per page */
  pageSize?: number
  /** Whether to show pagination controls */
  showPagination?: boolean
}

// Chart/Map block types have been moved to their respective addon packages
// (crouton-charts, crouton-maps) and are now registered via croutonBlocks in app.config.ts.
// Type definitions are inlined in those packages' components.

// ============================================================================
// Block Type Union
// ============================================================================

export type BlockAttrs =
  | HeroBlockAttrs
  | SectionBlockAttrs
  | CTABlockAttrs
  | CardGridBlockAttrs
  | SeparatorBlockAttrs
  | RichTextBlockAttrs
  | CollectionBlockAttrs
  | FaqBlockAttrs
  | TwoColumnBlockAttrs
  | EmbedBlockAttrs
  | ImageBlockAttrs
  | LogoBlockAttrs
  | VideoBlockAttrs
  | FileBlockAttrs
  | ButtonRowBlockAttrs
  | StatsBlockAttrs
  | GalleryBlockAttrs
  | ContactBlockAttrs
  | MailingBlockAttrs
  | QrCodeBlockAttrs
  | PaneBlockAttrs

/**
 * paneBlock — hosts a pane *layout* inside the document flow (#706/#716). The
 * `layout` is the same "layout is data" `LayoutTree` the standalone layout
 * engine persists; it serializes into the page's `content` JSON like any other
 * block. Untrusted on render → run through `sanitizeLayoutTree` (the public
 * Render component does this; the renderer additionally allowlists block ids).
 */
export interface PaneBlockAttrs {
  /** The pane layout tree, or null until the author composes one. */
  layout?: LayoutTree | null
  /** Pane height in document flow (px) — Splitter panes are height-driven. */
  height?: number
}

// ============================================================================
// Block Node Types (TipTap format)
// ============================================================================

export interface PageBlock<T extends BlockAttrs = BlockAttrs> {
  /** Core block type or addon block type string (e.g. 'chartBlock', 'mapBlock') */
  type: BlockType | string
  attrs: T
}

export interface HeroBlock extends PageBlock<HeroBlockAttrs> {
  type: 'heroBlock'
}

export interface SectionBlock extends PageBlock<SectionBlockAttrs> {
  type: 'sectionBlock'
}

export interface CTABlock extends PageBlock<CTABlockAttrs> {
  type: 'ctaBlock'
}

export interface CardGridBlock extends PageBlock<CardGridBlockAttrs> {
  type: 'cardGridBlock'
}

export interface SeparatorBlock extends PageBlock<SeparatorBlockAttrs> {
  type: 'separatorBlock'
}

export interface RichTextBlock extends PageBlock<RichTextBlockAttrs> {
  type: 'richTextBlock'
}

export interface CollectionBlock extends PageBlock<CollectionBlockAttrs> {
  type: 'collectionBlock'
}

export interface FaqBlock extends PageBlock<FaqBlockAttrs> {
  type: 'faqBlock'
}

export interface TwoColumnBlock extends PageBlock<TwoColumnBlockAttrs> {
  type: 'twoColumnBlock'
}


export type ImageBlockWidth = 'full' | 'large' | 'medium' | 'small'

export interface ImageBlockAttrs {
  /** Image source URL */
  src: string
  /** Alt text for accessibility */
  alt?: string
  /** Optional caption below the image */
  caption?: string
  /** Display width: full (100%), large (80%), medium (60%), small (40%) */
  width?: ImageBlockWidth
}

export interface ImageBlock extends PageBlock<ImageBlockAttrs> {
  type: 'imageBlock'
}

export interface EmbedBlockAttrs {
  /** Raw URL entered by user */
  url: string
  /** Auto-detected or manually set provider */
  provider: 'youtube' | 'figma' | 'custom'
  /** Embed height in pixels */
  height: number
  /** Optional caption below the iframe */
  caption: string
}

export interface EmbedBlock extends PageBlock<EmbedBlockAttrs> {
  type: 'embedBlock'
}

export type LogoItemType = 'icon' | 'image'
export type LogoAlign = 'center' | 'between'
export type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface LogoItem {
  /** Whether this item is an icon name or an image URL */
  type?: LogoItemType
  /** Icon name (e.g., 'i-simple-icons-github') or image URL */
  value: string
  /** Alt text when value is an image URL */
  alt?: string
  /** Optional link URL for this logo item */
  link?: string
}

export interface LogoBlockAttrs {
  /** Title displayed above the logos */
  title?: string
  /** Enable marquee scrolling effect */
  marquee?: boolean
  /** Alignment of logos: center or space-between */
  align?: LogoAlign
  /** Size of logo items */
  size?: LogoSize
  /** Logo items — icon names or image URLs */
  items: LogoItem[]
}

export interface LogoBlock extends PageBlock<LogoBlockAttrs> {
  type: 'logoBlock'
}

export type VideoBlockWidth = 'full' | 'large' | 'medium' | 'small'

export interface VideoBlockAttrs {
  /** Video source URL */
  src: string
  /** Optional caption below the video */
  caption?: string
  /** Display width: full (100%), large (80%), medium (60%), small (40%) */
  width?: VideoBlockWidth
  /** Auto-play the video on load */
  autoplay?: boolean
  /** Loop the video */
  loop?: boolean
  /** Mute the video */
  muted?: boolean
  /** Show video controls */
  controls?: boolean
}

export interface VideoBlock extends PageBlock<VideoBlockAttrs> {
  type: 'videoBlock'
}

export interface FileBlockAttrs {
  /** Button label text (e.g., "Download Report") */
  label: string
  /** File URL (from upload, e.g., "/images/report.pdf") */
  file: string
  /** Original file name for display */
  fileName?: string
  /** Optional icon (default: i-lucide-download) */
  icon?: string
}

export interface FileBlock extends PageBlock<FileBlockAttrs> {
  type: 'fileBlock'
}

export interface ButtonRowItem {
  label: string
  to?: string
  /** Id of a CMS page to link to; resolved to its canonical URL at render. Takes precedence over `to`. */
  pageId?: string
  file?: string
  fileName?: string
  download?: boolean
  external?: boolean
  color?: ButtonColor
  variant?: ButtonVariant
  icon?: string
}

export interface ButtonRowBlockAttrs {
  buttons: ButtonRowItem[]
  align?: 'left' | 'center' | 'right'
}

export interface StatItem {
  value: number
  label: string
  prefix?: string
  suffix?: string
}

export interface StatsBlockAttrs {
  headline?: string
  title?: string
  description?: string
  stats: StatItem[]
  columns?: 2 | 3 | 4
}

export interface ButtonRowBlock extends PageBlock<ButtonRowBlockAttrs> {
  type: 'buttonRowBlock'
}

export interface StatsBlock extends PageBlock<StatsBlockAttrs> {
  type: 'statsBlock'
}

export interface GalleryItem {
  src: string
  alt?: string
}

export type GalleryHeight = 'sm' | 'md' | 'lg' | 'xl'

export interface GalleryBlockAttrs {
  headline?: string
  title?: string
  description?: string
  images: GalleryItem[]
  height?: GalleryHeight
}

export interface GalleryBlock extends PageBlock<GalleryBlockAttrs> {
  type: 'galleryBlock'
}

export type ContactLayout = 'vertical' | 'horizontal'

export interface ContactBlockAttrs {
  mode: 'manual' | 'member'
  memberId?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  role?: string
  company?: string
  website?: string
  avatar?: string
  showAvatar?: boolean
  layout?: ContactLayout
}

export interface ContactBlock extends PageBlock<ContactBlockAttrs> {
  type: 'contactBlock'
}

export type MailingProvider = 'mailchimp' | 'custom'

export interface MailingBlockAttrs {
  /** The form action URL (e.g., Mailchimp subscribe endpoint) */
  actionUrl: string
  /** Provider hint for form structure */
  provider: MailingProvider
  /** Email field name attribute (default: 'EMAIL') */
  emailFieldName: string
  /** Honeypot field name for bot protection (optional) */
  honeypotFieldName?: string
  /** Heading text above the form */
  title?: string
  /** Description text below the heading */
  description?: string
  /** Submit button label */
  buttonLabel: string
  /** Placeholder text for the email input */
  placeholder: string
}

export interface MailingBlock extends PageBlock<MailingBlockAttrs> {
  type: 'mailingBlock'
}

export type QrCodeSize = 'sm' | 'md' | 'lg'

export interface QrCodeBlockAttrs {
  /** Id of a CMS page to encode; resolved to its absolute public URL at render. Takes precedence over `url`. */
  pageId?: string
  /** Fallback custom URL (absolute) encoded when no page is selected. */
  url?: string
  /** Optional caption shown beneath the QR code. */
  caption?: string
  /** Rendered size preset. */
  size?: QrCodeSize
  /** Horizontal alignment within the block. */
  align?: 'left' | 'center' | 'right'
}

export interface QrCodeBlock extends PageBlock<QrCodeBlockAttrs> {
  type: 'qrCodeBlock'
}

// ============================================================================
// Document Type
// ============================================================================

export interface PageBlockContent {
  type: 'doc'
  content: PageBlock[]
}

// ============================================================================
// Block Visibility (universal attr, like blockSize)
// ============================================================================

/**
 * Screen sizes a block can be limited to. The boundaries are 768px and 1024px,
 * matching the breakpoints the public surfaces already use (`Nav.vue`,
 * `layouts/public.vue`).
 */
export type BlockViewport = 'mobile' | 'tablet' | 'desktop'

/**
 * Team roles a block can be limited to.
 *
 * Deliberately declared here rather than imported from `@fyit/crouton-auth`:
 * crouton-pages does not depend on the auth package (it may not be installed),
 * and the visibility matcher must degrade gracefully when it isn't. Kept in
 * step with `MemberRole` in `@fyit/crouton-auth/types/auth.ts`.
 */
export type BlockAudienceRole = 'owner' | 'admin' | 'member'

/**
 * Per-block display conditions, stored on the universal `blockVisibility` attr.
 *
 * Sparse by design — an absent key means "no restriction", so a block that has
 * never been configured carries nothing and renders exactly as it always did.
 *
 * NOT a security boundary: a hidden block is still present in the page payload,
 * it simply isn't displayed. Gate genuinely sensitive content with the
 * page-level `visibility` field, which is enforced server-side.
 */
export interface BlockVisibility {
  /** Limit to logged-out or logged-in readers. Absent = anyone. */
  audience?: 'anonymous' | 'authenticated'
  /** Limit to these team roles. Naming any role implies `authenticated`. */
  roles?: BlockAudienceRole[]
  /** Limit to these screen sizes. Absent or empty = all. */
  viewports?: BlockViewport[]
}

/**
 * What the renderer knows about the current reader.
 *
 * `null` means "not knowable" — crouton-auth isn't installed, or the session
 * hasn't resolved yet. The matcher shows the block in that case rather than
 * hiding it, so a missing auth package can never blank a page.
 */
export interface BlockAudienceContext {
  authenticated: boolean | null
  role: BlockAudienceRole | null
}

// ============================================================================
// Block Registry Types
// ============================================================================

export interface BlockDefinition<T extends BlockAttrs = BlockAttrs> {
  type: BlockType
  name: string
  description: string
  icon: string
  category: 'hero' | 'content' | 'cta' | 'layout' | 'faq' | 'media'
  defaultAttrs: T
  schema: BlockPropertySchema[]
}

export interface BlockPropertySchema {
  name: string
  type: 'text' | 'textarea' | 'select' | 'switch' | 'links' | 'features' | 'cards' | 'icon' | 'image' | 'video' | 'file' | 'collection' | 'faq-items' | 'logos' | 'chart-preset' | 'button-row-items' | 'stats-items' | 'gallery-items' | 'team-member' | 'page'
  label: string
  description?: string
  required?: boolean
  options?: { label: string; value: string }[]
  defaultValue?: unknown
  /** Conditionally show this field based on current block attrs */
  visibleWhen?: (attrs: Record<string, unknown>) => boolean
  /** Crop configuration for image fields */
  crop?: { aspectRatio?: BlockImageCropAspectRatio; circular?: boolean }
}

// ============================================================================
// Editor Types
// ============================================================================

export interface BlockEditorState {
  selectedBlockId: string | null
  isPropertyPanelOpen: boolean
}

export interface BlockMenuItem {
  type: BlockType | string
  name: string
  description: string
  icon: string
  category: string
}

