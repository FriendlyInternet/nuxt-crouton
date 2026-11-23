// Example schemas get_example_schema hands out. Kept in a plain module so the test can check
// every one against the generator's keys (#3165) — an example must never teach an ignored key.
export const EXAMPLE_SCHEMAS: Record<string, { description: string, schema: Record<string, any> }> = {
  products: {
    description: 'E-commerce product catalog with categories',
    schema: {
      name: {
        type: 'string',
        meta: { required: true, maxLength: 255, label: 'Product Name', sortable: true }
      },
      description: {
        type: 'text',
        meta: { label: 'Description' }
      },
      price: {
        type: 'decimal',
        meta: { required: true, precision: 10, scale: 2, min: 0, sortable: true }
      },
      inStock: {
        type: 'boolean',
        meta: { default: true, label: 'In Stock' }
      },
      categoryId: {
        type: 'string',
        refTarget: 'categories',
        meta: { required: true, label: 'Category' }
      },
      tags: {
        type: 'array',
        meta: { label: 'Tags' }
      },
      images: {
        type: 'json',
        meta: { label: 'Product Images', default: [] }
      }
    }
  },
  tasks: {
    description: 'Task management with status and assignments',
    schema: {
      title: {
        type: 'string',
        meta: { required: true, maxLength: 255, label: 'Task Title', sortable: true }
      },
      description: {
        type: 'text',
        meta: { label: 'Description' }
      },
      status: {
        type: 'string',
        meta: { required: true, default: 'pending', label: 'Status', displayAs: 'optionsSelect', options: ['pending', 'in-progress', 'done'] }
      },
      priority: {
        type: 'string',
        meta: { default: 'medium', label: 'Priority', displayAs: 'optionsSelect', options: ['low', 'medium', 'high'] }
      },
      dueDate: {
        type: 'date',
        meta: { label: 'Due Date', sortable: true }
      },
      assigneeId: {
        type: 'string',
        refTarget: 'users',
        meta: { label: 'Assignee' }
      },
      tags: {
        type: 'array',
        meta: { label: 'Tags' }
      }
    }
  },
  blog: {
    description: 'Blog posts with author and categories',
    schema: {
      title: {
        type: 'string',
        meta: { required: true, maxLength: 255, label: 'Title', sortable: true }
      },
      slug: {
        type: 'string',
        meta: { required: true, unique: true, label: 'URL Slug' }
      },
      content: {
        type: 'text',
        meta: { required: true, label: 'Content' }
      },
      excerpt: {
        type: 'text',
        meta: { maxLength: 500, label: 'Excerpt' }
      },
      published: {
        type: 'boolean',
        meta: { default: false, label: 'Published' }
      },
      publishedAt: {
        type: 'date',
        meta: { label: 'Published Date', sortable: true }
      },
      authorId: {
        type: 'string',
        refTarget: 'users',
        meta: { required: true, label: 'Author' }
      },
      categoryId: {
        type: 'string',
        refTarget: 'categories',
        meta: { label: 'Category' }
      },
      featuredImage: {
        type: 'string',
        meta: { label: 'Featured Image URL' }
      }
    }
  },
  invoices: {
    description: 'Invoices with line items (repeater example)',
    schema: {
      invoiceNumber: {
        type: 'string',
        meta: { required: true, unique: true, label: 'Invoice #' }
      },
      clientId: {
        type: 'string',
        refTarget: 'clients',
        meta: { required: true, label: 'Client' }
      },
      status: {
        type: 'string',
        meta: { required: true, default: 'draft', label: 'Status', displayAs: 'optionsSelect', options: ['draft', 'sent', 'paid'] }
      },
      issueDate: {
        type: 'date',
        meta: { required: true, label: 'Issue Date', sortable: true }
      },
      dueDate: {
        type: 'date',
        meta: { label: 'Due Date' }
      },
      items: {
        type: 'repeater',
        meta: {
          label: 'Line Items',
          properties: {
            description: { type: 'string', required: true },
            quantity: { type: 'number', required: true, default: 1 },
            unitPrice: { type: 'decimal', required: true }
          }
        }
      },
      notes: {
        type: 'text',
        meta: { label: 'Notes' }
      },
      total: {
        type: 'decimal',
        meta: { precision: 10, scale: 2, label: 'Total' }
      }
    }
  },
  events: {
    description: 'Events with location and scheduling',
    schema: {
      title: {
        type: 'string',
        meta: { required: true, maxLength: 255, label: 'Event Title', sortable: true }
      },
      description: {
        type: 'text',
        meta: { label: 'Description' }
      },
      startDate: {
        type: 'date',
        meta: { required: true, label: 'Start Date', sortable: true }
      },
      endDate: {
        type: 'date',
        meta: { label: 'End Date' }
      },
      location: {
        type: 'string',
        meta: { label: 'Location' }
      },
      isAllDay: {
        type: 'boolean',
        meta: { default: false, label: 'All Day Event' }
      },
      capacity: {
        type: 'number',
        meta: { min: 0, label: 'Capacity' }
      },
      organizerId: {
        type: 'string',
        refTarget: 'users',
        meta: { label: 'Organizer' }
      },
      metadata: {
        type: 'json',
        meta: { label: 'Additional Data', default: {} }
      }
    }
  }
}
