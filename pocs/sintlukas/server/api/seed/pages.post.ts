/**
 * Seed script for Sint-Lukas pages
 *
 * Creates the 5 core pages:
 * 1. Home (regular page)
 * 2. Aanbod (collection binder → contentAteliers, groupBy: category)
 * 3. Academie (regular page)
 * 4. Contact (regular page)
 * 5. Inschrijven (regular page)
 *
 * Trigger via POST /api/seed/pages
 */
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { organization, member } from '~~/server/db/schema'
import { pagesPages } from '@fyit/crouton-pages/collections/pages/server/database/schema'

export default defineEventHandler(async (event) => {
  const db = useDB()
  const log: string[] = []
  const now = new Date()

  // Find the organization
  const orgs = await (db as any).select().from(organization).limit(1)
  if (!orgs.length) {
    throw createError({
      status: 400,
      statusText: 'No organization found. Start the dev server and create one via admin first.'
    })
  }
  const orgId = orgs[0].id

  // Find an owner for createdBy/updatedBy
  const members = await (db as any).select().from(member).where(eq(member.organizationId, orgId)).limit(1)
  const ownerId = members?.[0]?.userId || orgId

  log.push(`Using organization: ${orgs[0].name} (${orgId})`)

  // Clear existing pages
  await (db as any).delete(pagesPages).where(eq(pagesPages.teamId, orgId))
  log.push('Cleared existing pages')

  const pages = [
    {
      id: nanoid(),
      teamId: orgId,
      owner: ownerId,
      parentId: null,
      path: '/home',
      depth: 0,
      order: 0,
      title: 'Home',
      slug: '',
      pageType: 'pages:regular',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'heroBlock',
            attrs: {
              title: 'Sint-Lukas Academie',
              description: 'Dé academie voor beeldende kunsten in hartje Brussel. Ontdek onze ateliers voor kinderen, jongeren en volwassenen.',
              align: 'center'
            }
          }
        ]
      }),
      config: {},
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: true,
      layout: 'public',
      seoTitle: 'Sint-Lukas Academie - Beeldende Kunsten Brussel',
      seoDescription: 'Dé academie voor beeldende kunsten in hartje Brussel.',
      ogImage: null,
      robots: null,
      translations: {
        nl: { title: 'Home' },
        fr: { title: 'Accueil' },
        en: { title: 'Home' }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId
    },
    {
      id: nanoid(),
      teamId: orgId,
      owner: ownerId,
      parentId: null,
      path: '/aanbod',
      depth: 0,
      order: 1,
      title: 'Aanbod',
      slug: 'aanbod',
      pageType: 'pages:collection-binder',
      content: null,
      config: {
        collection: 'contentAteliers',
        groupBy: 'category',
        sortField: 'order',
        sortOrder: 'asc'
      },
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: true,
      layout: 'public',
      seoTitle: 'Aanbod - Sint-Lukas Academie',
      seoDescription: 'Ontdek ons volledig aanbod aan ateliers voor beeldende kunsten.',
      ogImage: null,
      robots: null,
      translations: {
        nl: { title: 'Aanbod' },
        fr: { title: 'Offre' },
        en: { title: 'Courses' }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId
    },
    {
      id: nanoid(),
      teamId: orgId,
      owner: ownerId,
      parentId: null,
      path: '/academie',
      depth: 0,
      order: 2,
      title: 'Academie',
      slug: 'academie',
      pageType: 'pages:regular',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'heroBlock',
            attrs: {
              title: 'Over de Academie',
              description: 'Sint-Lukas Academie biedt al meer dan een eeuw beeldende kunsten aan in het hart van Brussel. Wij geloven in de kracht van creativiteit en artistieke expressie.',
              align: 'left'
            }
          },
          {
            type: 'richTextBlock',
            attrs: {
              content: '<h2>Onze Missie</h2><p>Sint-Lukas Academie staat voor kwalitatief kunstonderwijs dat toegankelijk is voor iedereen. Van kinderen tot volwassenen, van beginners tot gevorderden — iedereen vindt hier een creatieve thuis.</p><h2>Geschiedenis</h2><p>Al sinds 1880 vormt Sint-Lukas Academie een belangrijke pijler in het Brusselse kunstlandschap. Onze academie combineert traditie met hedendaagse artistieke praktijken.</p>'
            }
          }
        ]
      }),
      config: {},
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: true,
      layout: 'public',
      seoTitle: 'Over de Academie - Sint-Lukas',
      seoDescription: 'Leer meer over Sint-Lukas Academie, onze missie en geschiedenis.',
      ogImage: null,
      robots: null,
      translations: {
        nl: { title: 'Academie' },
        fr: { title: 'Académie' },
        en: { title: 'Academy' }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId
    },
    {
      id: nanoid(),
      teamId: orgId,
      owner: ownerId,
      parentId: null,
      path: '/contact',
      depth: 0,
      order: 3,
      title: 'Contact',
      slug: 'contact',
      pageType: 'pages:regular',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'heroBlock',
            attrs: {
              title: 'Contact',
              description: 'Neem contact op met Sint-Lukas Academie. Wij helpen je graag verder.',
              align: 'left'
            }
          },
          {
            type: 'richTextBlock',
            attrs: {
              content: '<h2>Adres</h2><p>Groenstraat 156<br>1030 Schaarbeek (Brussel)</p><h2>Bereikbaarheid</h2><p>Tram 92, 93 — halte Liedts<br>Metro 2, 6 — station Rogier of Yser</p><h2>Secretariaat</h2><p>Maandag t/m vrijdag: 16:00 – 21:00<br>Zaterdag: 09:00 – 12:00</p>'
            }
          }
        ]
      }),
      config: {},
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: true,
      layout: 'public',
      seoTitle: 'Contact - Sint-Lukas Academie',
      seoDescription: 'Contacteer Sint-Lukas Academie in Brussel.',
      ogImage: null,
      robots: null,
      translations: {
        nl: { title: 'Contact' },
        fr: { title: 'Contact' },
        en: { title: 'Contact' }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId
    },
    {
      id: nanoid(),
      teamId: orgId,
      owner: ownerId,
      parentId: null,
      path: '/inschrijven',
      depth: 0,
      order: 4,
      title: 'Inschrijven',
      slug: 'inschrijven',
      pageType: 'pages:regular',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'heroBlock',
            attrs: {
              title: 'Inschrijven',
              description: 'Schrijf je in voor een atelier bij Sint-Lukas Academie.',
              align: 'center'
            }
          },
          {
            type: 'richTextBlock',
            attrs: {
              content: '<h2>Inschrijvingen</h2><p>De inschrijvingen voor het nieuwe schooljaar starten in september. Kom langs op het secretariaat of schrijf je online in.</p><h2>Wat meebrengen?</h2><ul><li>Identiteitskaart</li><li>Pasfoto</li><li>Inschrijvingsgeld (afhankelijk van het atelier)</li></ul><h2>Meer info</h2><p>Voor vragen over inschrijvingen kan je terecht bij het secretariaat tijdens de openingsuren.</p>'
            }
          }
        ]
      }),
      config: {},
      status: 'published',
      visibility: 'public',
      publishedAt: now,
      showInNavigation: true,
      layout: 'public',
      seoTitle: 'Inschrijven - Sint-Lukas Academie',
      seoDescription: 'Schrijf je in bij Sint-Lukas Academie voor beeldende kunsten in Brussel.',
      ogImage: null,
      robots: null,
      translations: {
        nl: { title: 'Inschrijven' },
        fr: { title: "S'inscrire" },
        en: { title: 'Register' }
      },
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId
    }
  ]

  for (const page of pages) {
    await (db as any).insert(pagesPages).values(page)
    log.push(`Created page: ${page.title} (${page.slug || '/'}) — ${page.pageType}`)
  }

  return {
    success: true,
    pagesCreated: pages.length,
    log
  }
})
