/**
 * Block Registry
 *
 * Defines all available block types with their schemas and default values.
 * Used by the editor for block creation and property editing.
 */

import type {
  BlockDefinition,
  BlockType,
  HeroBlockAttrs,
  SectionBlockAttrs,
  CTABlockAttrs,
  CardGridBlockAttrs,
  SeparatorBlockAttrs,
  RichTextBlockAttrs,
  CollectionBlockAttrs,
  FaqBlockAttrs,
  TwoColumnBlockAttrs,
  EmbedBlockAttrs,
  ImageBlockAttrs,
  LogoBlockAttrs,
  VideoBlockAttrs,
  FileBlockAttrs,
  ButtonRowBlockAttrs,
  StatsBlockAttrs,
  GalleryBlockAttrs,
  ContactBlockAttrs,
  MailingBlockAttrs,
  QrCodeBlockAttrs,
  PaneBlockAttrs,
  BlockMenuItem
} from '../types/blocks'

// ============================================================================
// Block Definitions
// ============================================================================

export const heroBlockDefinition: BlockDefinition<HeroBlockAttrs> = {
  type: 'heroBlock',
  name: 'Hero',
  description: 'A responsive hero section with title, description, and CTA buttons',
  icon: 'i-lucide-layout-template',
  category: 'hero',
  defaultAttrs: {
    title: 'Welcome to our site',
    description: 'Add a compelling description for your hero section.',
    orientation: 'vertical',
    reverse: false,
    links: []
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline',
      description: 'Small text above the title'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'orientation',
      type: 'select',
      label: 'Orientation',
      options: [
        { label: 'Vertical', value: 'vertical' },
        { label: 'Horizontal', value: 'horizontal' }
      ],
      defaultValue: 'vertical'
    },
    {
      name: 'reverse',
      type: 'switch',
      label: 'Reverse Layout',
      description: 'Swap content and image positions'
    },
    {
      name: 'links',
      type: 'links',
      label: 'Call to Action Buttons'
    },
    {
      name: 'image',
      type: 'image',
      label: 'Hero Image',
      crop: { aspectRatio: '16:9' }
    }
  ]
}

export const sectionBlockDefinition: BlockDefinition<SectionBlockAttrs> = {
  type: 'sectionBlock',
  name: 'Section',
  description: 'A content section with features grid',
  icon: 'i-lucide-square-stack',
  category: 'content',
  defaultAttrs: {
    title: 'Section Title',
    description: 'Describe this section.',
    orientation: 'vertical',
    reverse: false,
    features: []
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline',
      description: 'Small text above the title'
    },
    {
      name: 'icon',
      type: 'icon',
      label: 'Icon',
      description: 'Icon displayed above the title'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'orientation',
      type: 'select',
      label: 'Orientation',
      options: [
        { label: 'Vertical', value: 'vertical' },
        { label: 'Horizontal', value: 'horizontal' }
      ],
      defaultValue: 'vertical'
    },
    {
      name: 'reverse',
      type: 'switch',
      label: 'Reverse Layout'
    },
    {
      name: 'features',
      type: 'features',
      label: 'Features'
    },
    {
      name: 'links',
      type: 'links',
      label: 'Action Buttons'
    }
  ]
}

export const ctaBlockDefinition: BlockDefinition<CTABlockAttrs> = {
  type: 'ctaBlock',
  name: 'Call to Action',
  description: 'A call-to-action banner',
  icon: 'i-lucide-megaphone',
  category: 'cta',
  defaultAttrs: {
    title: 'Ready to get started?',
    description: 'Start your journey today.',
    orientation: 'vertical',
    variant: 'outline',
    links: []
  },
  schema: [
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'orientation',
      type: 'select',
      label: 'Orientation',
      options: [
        { label: 'Vertical', value: 'vertical' },
        { label: 'Horizontal', value: 'horizontal' }
      ],
      defaultValue: 'vertical'
    },
    {
      name: 'reverse',
      type: 'switch',
      label: 'Reverse Layout'
    },
    {
      name: 'variant',
      type: 'select',
      label: 'Style',
      options: [
        { label: 'Outline', value: 'outline' },
        { label: 'Solid', value: 'solid' },
        { label: 'Soft', value: 'soft' },
        { label: 'Subtle', value: 'subtle' },
        { label: 'Naked', value: 'naked' }
      ],
      defaultValue: 'outline'
    },
    {
      name: 'links',
      type: 'links',
      label: 'Action Buttons'
    }
  ]
}

export const cardGridBlockDefinition: BlockDefinition<CardGridBlockAttrs> = {
  type: 'cardGridBlock',
  name: 'Card Grid',
  description: 'A grid of cards with icons and links',
  icon: 'i-lucide-layout-grid',
  category: 'content',
  defaultAttrs: {
    columns: 3,
    cards: [
      { title: 'Card 1', description: 'First card description' },
      { title: 'Card 2', description: 'Second card description' },
      { title: 'Card 3', description: 'Third card description' }
    ]
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title'
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'columns',
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
        { label: '4 Columns', value: '4' }
      ],
      defaultValue: '3'
    },
    {
      name: 'cards',
      type: 'cards',
      label: 'Cards'
    }
  ]
}

export const separatorBlockDefinition: BlockDefinition<SeparatorBlockAttrs> = {
  type: 'separatorBlock',
  name: 'Separator',
  description: 'A visual divider between sections',
  icon: 'i-lucide-minus',
  category: 'layout',
  defaultAttrs: {
    type: 'solid'
  },
  schema: [
    {
      name: 'label',
      type: 'text',
      label: 'Label',
      description: 'Optional text in the middle of the separator'
    },
    {
      name: 'icon',
      type: 'icon',
      label: 'Icon',
      description: 'Optional icon instead of text'
    },
    {
      name: 'type',
      type: 'select',
      label: 'Line Style',
      options: [
        { label: 'Solid', value: 'solid' },
        { label: 'Dashed', value: 'dashed' },
        { label: 'Dotted', value: 'dotted' }
      ],
      defaultValue: 'solid'
    }
  ]
}

export const richTextBlockDefinition: BlockDefinition<RichTextBlockAttrs> = {
  type: 'richTextBlock',
  name: 'Rich Text',
  description: 'Standard formatted text content',
  icon: 'i-lucide-type',
  category: 'content',
  defaultAttrs: {
    content: '<p>Start writing...</p>'
  },
  schema: [
    {
      name: 'content',
      type: 'textarea',
      label: 'Content',
      required: true
    }
  ]
}

export const collectionBlockDefinition: BlockDefinition<CollectionBlockAttrs> = {
  type: 'collectionBlock',
  name: 'Collection',
  description: 'Embed a collection in view-only mode',
  icon: 'i-lucide-database',
  category: 'content',
  defaultAttrs: {
    collection: '',
    layout: 'table',
    pageSize: 10,
    showPagination: true
  },
  schema: [
    {
      name: 'collection',
      type: 'collection',
      label: 'Collection',
      required: true,
      description: 'Select a collection to display'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      description: 'Optional title above the collection'
    },
    {
      name: 'layout',
      type: 'select',
      label: 'Layout',
      options: [
        { label: 'Table', value: 'table' },
        { label: 'List', value: 'list' },
        { label: 'Grid', value: 'grid' },
        { label: 'Cards', value: 'cards' }
      ],
      defaultValue: 'table'
    },
    {
      name: 'pageSize',
      type: 'select',
      label: 'Items per page',
      options: [
        { label: '5 items', value: '5' },
        { label: '10 items', value: '10' },
        { label: '20 items', value: '20' },
        { label: '50 items', value: '50' }
      ],
      defaultValue: '10'
    },
    {
      name: 'showPagination',
      type: 'switch',
      label: 'Show Pagination',
      defaultValue: true
    }
  ]
}

// ============================================================================
// Registry
// ============================================================================

export const faqBlockDefinition: BlockDefinition<FaqBlockAttrs> = {
  type: 'faqBlock',
  name: 'FAQ',
  description: 'A collapsible FAQ accordion',
  icon: 'i-lucide-help-circle',
  category: 'content',
  defaultAttrs: {
    items: [
      { question: 'What is this?', answer: 'A great question — add your answer here.' },
      { question: 'How does it work?', answer: 'Describe how it works here.' }
    ],
    allowMultiple: false
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline',
      description: 'Small text above the title'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title'
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'allowMultiple',
      type: 'switch',
      label: 'Allow multiple open',
      description: 'Let users expand more than one item at a time'
    },
    {
      name: 'items',
      type: 'faq-items',
      label: 'Questions'
    }
  ]
}

export const twoColumnBlockDefinition: BlockDefinition<TwoColumnBlockAttrs> = {
  type: 'twoColumnBlock',
  name: 'Two Columns',
  description: 'Side-by-side two-column layout',
  icon: 'i-lucide-columns-2',
  category: 'layout',
  defaultAttrs: {
    split: '1/2',
    leftTitle: 'Left column',
    leftDescription: 'Add content for the left side.',
    rightTitle: 'Right column',
    rightDescription: 'Add content for the right side.'
  },
  schema: [
    {
      name: 'split',
      type: 'select',
      label: 'Column split',
      options: [
        { label: 'Equal (50/50)', value: '1/2' },
        { label: 'Left narrow (33/67)', value: '1/3' },
        { label: 'Left wide (67/33)', value: '2/3' }
      ],
      defaultValue: '1/2'
    },
    { name: 'leftTitle', type: 'text', label: 'Left: Title' },
    { name: 'leftDescription', type: 'textarea', label: 'Left: Description' },
    { name: 'leftImage', type: 'image', label: 'Left: Image' },
    { name: 'leftLinks', type: 'links', label: 'Left: Buttons' },
    { name: 'rightTitle', type: 'text', label: 'Right: Title' },
    { name: 'rightDescription', type: 'textarea', label: 'Right: Description' },
    { name: 'rightImage', type: 'image', label: 'Right: Image' },
    { name: 'rightLinks', type: 'links', label: 'Right: Buttons' }
  ]
}

// Chart, Map, and CollectionMap block definitions have been moved to their
// respective addon packages (crouton-charts, crouton-maps) and are now
// registered via croutonBlocks in app.config.ts.

export const imageBlockDefinition: BlockDefinition<ImageBlockAttrs> = {
  type: 'imageBlock',
  name: 'Image',
  description: 'A standalone image with optional caption',
  icon: 'i-lucide-image',
  category: 'media',
  defaultAttrs: {
    src: '',
    alt: '',
    caption: '',
    width: 'full'
  },
  schema: [
    {
      name: 'src',
      type: 'image',
      label: 'Image',
      required: true
    },
    {
      name: 'alt',
      type: 'text',
      label: 'Alt Text',
      description: 'Describe the image for accessibility'
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
      description: 'Optional caption displayed below the image'
    },
    {
      name: 'width',
      type: 'select',
      label: 'Width',
      options: [
        { label: 'Full (100%)', value: 'full' },
        { label: 'Large (80%)', value: 'large' },
        { label: 'Medium (60%)', value: 'medium' },
        { label: 'Small (40%)', value: 'small' }
      ],
      defaultValue: 'full'
    }
  ]
}

export const logoBlockDefinition: BlockDefinition<LogoBlockAttrs> = {
  type: 'logoBlock',
  name: 'Logos',
  description: 'A row of logos or brand icons with optional marquee',
  icon: 'i-lucide-award',
  category: 'content',
  defaultAttrs: {
    title: 'Trusted by the best teams',
    marquee: false,
    align: 'center',
    size: 'md',
    items: [
      { value: 'i-lucide-github' },
      { value: 'i-lucide-x' },
      { value: 'i-lucide-linkedin' },
      { value: 'i-lucide-facebook' },
      { value: 'i-lucide-instagram' }
    ]
  },
  schema: [
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      description: 'Text displayed above the logos'
    },
    {
      name: 'align',
      type: 'select',
      label: 'Alignment',
      description: 'How logos are distributed',
      defaultValue: 'center',
      options: [
        { label: 'Center', value: 'center' },
        { label: 'Space Between', value: 'between' }
      ]
    },
    {
      name: 'size',
      type: 'select',
      label: 'Size',
      description: 'Logo size',
      defaultValue: 'md',
      options: [
        { label: 'XS', value: 'xs' },
        { label: 'SM', value: 'sm' },
        { label: 'MD', value: 'md' },
        { label: 'LG', value: 'lg' },
        { label: 'XL', value: 'xl' }
      ]
    },
    {
      name: 'marquee',
      type: 'switch',
      label: 'Marquee',
      description: 'Enable scrolling marquee animation'
    },
    {
      name: 'items',
      type: 'logos',
      label: 'Logos'
    }
  ]
}

export const videoBlockDefinition: BlockDefinition<VideoBlockAttrs> = {
  type: 'videoBlock',
  name: 'Video',
  description: 'A standalone video with optional caption and playback controls',
  icon: 'i-lucide-video',
  category: 'media',
  defaultAttrs: {
    src: '',
    caption: '',
    width: 'full',
    autoplay: false,
    loop: false,
    muted: true,
    controls: true
  },
  schema: [
    {
      name: 'src',
      type: 'video',
      label: 'Video',
      required: true
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
      description: 'Optional caption displayed below the video'
    },
    {
      name: 'width',
      type: 'select',
      label: 'Width',
      options: [
        { label: 'Full (100%)', value: 'full' },
        { label: 'Large (80%)', value: 'large' },
        { label: 'Medium (60%)', value: 'medium' },
        { label: 'Small (40%)', value: 'small' }
      ],
      defaultValue: 'full'
    },
    {
      name: 'autoplay',
      type: 'switch',
      label: 'Autoplay',
      description: 'Automatically play the video on page load'
    },
    {
      name: 'loop',
      type: 'switch',
      label: 'Loop',
      description: 'Loop the video when it ends'
    },
    {
      name: 'muted',
      type: 'switch',
      label: 'Muted',
      description: 'Mute the video by default'
    },
    {
      name: 'controls',
      type: 'switch',
      label: 'Show Controls',
      description: 'Display video playback controls'
    }
  ]
}

export const embedBlockDefinition: BlockDefinition<EmbedBlockAttrs> = {
  type: 'embedBlock',
  name: 'Embed',
  description: 'Embed YouTube videos, Figma files, or any URL',
  icon: 'i-lucide-youtube',
  category: 'content',
  defaultAttrs: {
    url: '',
    provider: 'custom',
    height: 400,
    caption: ''
  },
  schema: [
    {
      name: 'url',
      type: 'text',
      label: 'URL',
      required: true,
      description: 'YouTube, Figma, or any embeddable URL'
    },
    {
      name: 'height',
      type: 'select',
      label: 'Height',
      options: [
        { label: 'Small (300px)', value: '300' },
        { label: 'Medium (400px)', value: '400' },
        { label: 'Large (550px)', value: '550' },
        { label: 'Full HD (720px)', value: '720' }
      ],
      defaultValue: '400'
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
      description: 'Optional caption displayed below the embed'
    }
  ]
}

export const fileBlockDefinition: BlockDefinition<FileBlockAttrs> = {
  type: 'fileBlock',
  name: 'File Download',
  description: 'A downloadable file button with label',
  icon: 'i-lucide-file-down',
  category: 'media',
  defaultAttrs: {
    label: 'Download file',
    file: '',
    fileName: '',
    icon: 'i-lucide-download'
  },
  schema: [
    {
      name: 'label',
      type: 'text',
      label: 'Button Label',
      required: true,
      description: 'Text shown on the download button'
    },
    {
      name: 'file',
      type: 'file',
      label: 'File',
      required: true,
      description: 'Upload or link a file'
    },
    {
      name: 'icon',
      type: 'icon',
      label: 'Icon',
      description: 'Icon shown on the button',
      defaultValue: 'i-lucide-download'
    }
  ]
}

export const buttonRowBlockDefinition: BlockDefinition<ButtonRowBlockAttrs> = {
  type: 'buttonRowBlock',
  name: 'Button Row',
  description: 'A row of link and download buttons',
  icon: 'i-lucide-rows-3',
  category: 'cta',
  defaultAttrs: {
    buttons: [],
    align: 'left'
  },
  schema: [
    {
      name: 'align',
      type: 'select',
      label: 'Alignment',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' }
      ],
      defaultValue: 'left'
    },
    {
      name: 'buttons',
      type: 'button-row-items',
      label: 'Buttons'
    }
  ]
}

export const statsBlockDefinition: BlockDefinition<StatsBlockAttrs> = {
  type: 'statsBlock',
  name: 'Stats',
  description: 'Animated number counters with labels',
  icon: 'i-lucide-bar-chart-3',
  category: 'content',
  defaultAttrs: {
    columns: 3,
    stats: [
      { value: 10000, label: 'Happy Customers', suffix: '+' },
      { value: 99.9, label: 'Uptime', suffix: '%' },
      { value: 24, label: 'Support', suffix: '/7' }
    ]
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline',
      description: 'Small text above the title'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title'
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'columns',
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
        { label: '4 Columns', value: '4' }
      ],
      defaultValue: '3'
    },
    {
      name: 'stats',
      type: 'stats-items',
      label: 'Stats'
    }
  ]
}

export const galleryBlockDefinition: BlockDefinition<GalleryBlockAttrs> = {
  type: 'galleryBlock',
  name: 'Gallery',
  description: 'Expandable image gallery with hover effect',
  icon: 'i-lucide-gallery-horizontal-end',
  category: 'media',
  defaultAttrs: {
    images: [],
    height: 'md'
  },
  schema: [
    {
      name: 'headline',
      type: 'text',
      label: 'Headline',
      description: 'Small text above the title'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title'
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description'
    },
    {
      name: 'height',
      type: 'select',
      label: 'Height',
      options: [
        { label: 'Small (240px)', value: 'sm' },
        { label: 'Medium (384px)', value: 'md' },
        { label: 'Large (480px)', value: 'lg' },
        { label: 'Extra Large (600px)', value: 'xl' }
      ],
      defaultValue: 'md'
    },
    {
      name: 'images',
      type: 'gallery-items',
      label: 'Images'
    }
  ]
}

export const contactBlockDefinition: BlockDefinition<ContactBlockAttrs> = {
  type: 'contactBlock',
  name: 'Contact',
  description: 'A contact card with name, email, phone and more',
  icon: 'i-lucide-contact',
  category: 'content',
  defaultAttrs: {
    mode: 'manual',
    showAvatar: true,
    layout: 'vertical'
  },
  schema: [
    {
      name: 'layout',
      type: 'select',
      label: 'Layout',
      description: 'Card layout orientation',
      options: [
        { label: 'Vertical', value: 'vertical' },
        { label: 'Horizontal', value: 'horizontal' }
      ],
      defaultValue: 'vertical'
    },
    {
      name: 'mode',
      type: 'select',
      label: 'Mode',
      description: 'Fill in manually or select a team member',
      options: [
        { label: 'Manual', value: 'manual' },
        { label: 'Team Member', value: 'member' }
      ],
      defaultValue: 'manual'
    },
    {
      name: 'memberId',
      type: 'team-member',
      label: 'Team Member',
      description: 'Select a team member',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'member'
    },
    {
      name: 'firstName',
      type: 'text',
      label: 'First Name',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'lastName',
      type: 'text',
      label: 'Last Name',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'email',
      type: 'text',
      label: 'Email',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'phone',
      type: 'text',
      label: 'Phone',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'role',
      type: 'text',
      label: 'Role / Title',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'company',
      type: 'text',
      label: 'Company',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'website',
      type: 'text',
      label: 'Website',
      visibleWhen: (attrs: Record<string, unknown>) => attrs.mode === 'manual'
    },
    {
      name: 'showAvatar',
      type: 'switch',
      label: 'Show Avatar',
      defaultValue: true
    },
    {
      name: 'avatar',
      type: 'image',
      label: 'Avatar',
      crop: { aspectRatio: '1:1', circular: true },
      visibleWhen: (attrs: Record<string, unknown>) => attrs.showAvatar !== false
    }
  ]
}

export const mailingBlockDefinition: BlockDefinition<MailingBlockAttrs> = {
  type: 'mailingBlock',
  name: 'Mailing List',
  description: 'Email subscription form (Mailchimp or custom)',
  icon: 'i-lucide-mail',
  category: 'cta',
  defaultAttrs: {
    actionUrl: '',
    provider: 'mailchimp',
    emailFieldName: 'EMAIL',
    honeypotFieldName: '',
    title: 'Subscribe',
    description: '',
    buttonLabel: 'Subscribe',
    placeholder: 'Enter your email'
  },
  schema: [
    {
      name: 'provider',
      type: 'select',
      label: 'Provider',
      options: [
        { label: 'Mailchimp', value: 'mailchimp' },
        { label: 'Custom', value: 'custom' }
      ],
      defaultValue: 'mailchimp'
    },
    {
      name: 'actionUrl',
      type: 'text',
      label: 'Form Action URL',
      required: true,
      description: 'The subscribe endpoint URL (e.g., https://xxx.us5.list-manage.com/subscribe/post?u=...&id=...)'
    },
    {
      name: 'emailFieldName',
      type: 'text',
      label: 'Email Field Name',
      description: 'Name attribute for the email input (default: EMAIL for Mailchimp)'
    },
    {
      name: 'honeypotFieldName',
      type: 'text',
      label: 'Honeypot Field Name',
      description: 'Bot protection field name (optional, from your form provider)'
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      description: 'Heading above the form (optional)'
    },
    {
      name: 'description',
      type: 'text',
      label: 'Description',
      description: 'Text below the heading (optional)'
    },
    {
      name: 'buttonLabel',
      type: 'text',
      label: 'Button Label'
    },
    {
      name: 'placeholder',
      type: 'text',
      label: 'Placeholder Text'
    }
  ]
}

export const qrCodeBlockDefinition: BlockDefinition<QrCodeBlockAttrs> = {
  type: 'qrCodeBlock',
  name: 'QR Code',
  description: 'A scannable QR code linking to a page or URL',
  icon: 'i-lucide-qr-code',
  category: 'cta',
  defaultAttrs: {
    pageId: '',
    url: '',
    caption: '',
    size: 'md',
    align: 'center'
  },
  schema: [
    {
      name: 'pageId',
      type: 'page',
      label: 'Page',
      description: 'The page the QR code links to (resolved to its public URL)'
    },
    {
      name: 'url',
      type: 'text',
      label: 'Custom URL',
      description: 'Used when no page is selected. Must be an absolute URL.'
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
      description: 'Optional text shown beneath the QR code'
    },
    {
      name: 'size',
      type: 'select',
      label: 'Size',
      options: [
        { label: 'Small', value: 'sm' },
        { label: 'Medium', value: 'md' },
        { label: 'Large', value: 'lg' }
      ],
      defaultValue: 'md'
    },
    {
      name: 'align',
      type: 'select',
      label: 'Alignment',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' }
      ],
      defaultValue: 'center'
    }
  ]
}

export const paneBlockDefinition: BlockDefinition<PaneBlockAttrs> = {
  type: 'paneBlock',
  name: 'Pane Layout',
  description: 'A resizable, nestable pane layout composed from registered blocks',
  icon: 'i-lucide-layout-template',
  category: 'layout',
  defaultAttrs: {
    layout: null,
    height: 480
  },
  // No property-panel fields: the pane layout is composed INLINE in the editor
  // (CroutonLayout in PaneBlockView), not via the side property panel.
  schema: []
}

export const blockRegistry: Record<BlockType, BlockDefinition> = {
  heroBlock: heroBlockDefinition,
  sectionBlock: sectionBlockDefinition,
  ctaBlock: ctaBlockDefinition,
  cardGridBlock: cardGridBlockDefinition,
  separatorBlock: separatorBlockDefinition,
  richTextBlock: richTextBlockDefinition,
  collectionBlock: collectionBlockDefinition,
  faqBlock: faqBlockDefinition,
  twoColumnBlock: twoColumnBlockDefinition,
  embedBlock: embedBlockDefinition,
  imageBlock: imageBlockDefinition,
  logoBlock: logoBlockDefinition,
  videoBlock: videoBlockDefinition,
  fileBlock: fileBlockDefinition,
  buttonRowBlock: buttonRowBlockDefinition,
  statsBlock: statsBlockDefinition,
  galleryBlock: galleryBlockDefinition,
  contactBlock: contactBlockDefinition,
  mailingBlock: mailingBlockDefinition,
  qrCodeBlock: qrCodeBlockDefinition,
  paneBlock: paneBlockDefinition
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getBlockDefinition(type: BlockType): BlockDefinition | undefined {
  return blockRegistry[type]
}

export function getBlockDefaultAttrs<T extends BlockType>(type: T): BlockDefinition['defaultAttrs'] {
  const def = blockRegistry[type]
  return def ? { ...def.defaultAttrs } : {}
}

export function getAllBlockTypes(): BlockType[] {
  return Object.keys(blockRegistry) as BlockType[]
}

export function getBlockMenuItems(): BlockMenuItem[] {
  return Object.values(blockRegistry).map(def => ({
    type: def.type,
    name: def.name,
    description: def.description,
    icon: def.icon,
    category: def.category
  }))
}

export function getBlocksByCategory(): Record<string, BlockMenuItem[]> {
  const items = getBlockMenuItems()
  return items.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = []
    }
    acc[item.category]!.push(item)
    return acc
  }, {} as Record<string, BlockMenuItem[]>)
}

export function createBlock<T extends BlockType>(
  type: T,
  attrs?: Partial<BlockDefinition['defaultAttrs']>
): { type: T; attrs: BlockDefinition['defaultAttrs'] } {
  const defaultAttrs = getBlockDefaultAttrs(type)
  return {
    type,
    attrs: { ...defaultAttrs, ...attrs } as any
  }
}
