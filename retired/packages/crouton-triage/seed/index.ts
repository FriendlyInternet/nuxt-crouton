/**
 * crouton-triage seed provider (#697).
 *
 * Triage is a discussion-to-task pipeline (Slack/Figma/email → AI → Notion).
 * Most of its collections are *integration plumbing* tied to live credentials —
 * `accounts` (OAuth connections), `outputs` (Notion targets), `jobs` (sync
 * runs), `users` (platform identities) — so seeding them with fake rows would
 * misrepresent a working integration. This provider instead seeds the
 * **user-facing content chain** a reviewer actually opens:
 *
 *   flow → input → discussions → tasks   (+ a couple of inbox messages)
 *
 * so the Triage admin surfaces (overview / discussions / tasks / inbox) open
 * populated instead of empty. The integration-plumbing collections are left to
 * real connected accounts.
 *
 * Pure module: references the generated `triage_*` table/column names as
 * strings, loads under jiti. Idempotent — stable `seedId(...)` ids upsert in
 * place. Every NOT-NULL column is set explicitly (Drizzle `$default(...)` is
 * ORM-time, not a SQL DEFAULT, so raw-SQL upserts must supply them).
 */
import type { SeedProvider, SeedContext } from '@fyit/crouton-core/shared/seed'
import { seedId, raw } from '@fyit/crouton-core/shared/seed'

const FLOW_KEY = 'support'
const INPUT_KEY = 'support-slack'

function flowId(ctx: SeedContext): string {
  return seedId('triage-flow', ctx.teamSlug, FLOW_KEY)
}
function inputId(ctx: SeedContext): string {
  return seedId('triage-input', ctx.teamSlug, INPUT_KEY)
}
function discussionId(ctx: SeedContext, key: string): string {
  return seedId('triage-discussion', ctx.teamSlug, key)
}

interface SeedDiscussion {
  key: string
  title: string
  content: string
  authorHandle: string
  status: string
  totalMessages: number
  aiSummary: string
  aiKeyPoints: string[]
}

const DISCUSSIONS: SeedDiscussion[] = [
  {
    key: 'checkout-bug',
    title: 'Bug: checkout button unresponsive on mobile',
    content: 'Several customers report the checkout button does nothing on iOS Safari. Tapping it never opens the payment sheet.',
    authorHandle: '@sarah',
    status: 'completed',
    totalMessages: 6,
    aiSummary: 'A mobile-only checkout regression: the pay button is unresponsive on iOS Safari, blocking purchases.',
    aiKeyPoints: ['iOS Safari only', 'Blocks all mobile checkout', 'Started after the latest deploy']
  },
  {
    key: 'dark-mode',
    title: 'Feature request: dark mode for the dashboard',
    content: 'Multiple users in the channel are asking for a dark theme on the admin dashboard for late-night shifts.',
    authorHandle: '@miguel',
    status: 'completed',
    totalMessages: 12,
    aiSummary: 'Recurring request for a dark theme on the admin dashboard, driven by night-shift usage.',
    aiKeyPoints: ['High demand', 'Night-shift ergonomics', 'Dashboard scope only']
  },
  {
    key: 'rate-limits',
    title: 'Question about API rate limits',
    content: 'A partner is hitting 429s on the public API and wants to know the per-minute limit and how to request more.',
    authorHandle: '@aisha',
    status: 'pending',
    totalMessages: 3,
    aiSummary: 'Partner integration is hitting rate limits and needs documented thresholds plus an increase path.',
    aiKeyPoints: ['429 responses', 'Needs documented limits', 'Possible quota bump']
  }
]

interface SeedTask {
  discussionKey: string
  title: string
  description: string
  status: string
  priority: string
  assignee: string
}

const TASKS: SeedTask[] = [
  {
    discussionKey: 'checkout-bug',
    title: 'Fix unresponsive checkout button on mobile',
    description: 'Reproduce on iOS Safari, bisect the recent deploy, and restore the payment sheet trigger.',
    status: 'todo',
    priority: 'high',
    assignee: 'Sarah Chen'
  },
  {
    discussionKey: 'dark-mode',
    title: 'Implement dark mode toggle for the dashboard',
    description: 'Add a theme switch and dark token set scoped to the admin dashboard.',
    status: 'todo',
    priority: 'medium',
    assignee: 'Miguel Santos'
  }
]

interface SeedMessage {
  key: string
  from: string
  subject: string
  textBody: string
  read: boolean
}

const MESSAGES: SeedMessage[] = [
  {
    key: 'invoice',
    from: 'customer@acme.com',
    subject: 'Re: Invoice question',
    textBody: 'Hi — can you confirm whether invoice #4821 includes the seat upgrade we added last week?',
    read: false
  },
  {
    key: 'partnership',
    from: 'hello@partner.io',
    subject: 'Partnership opportunity',
    textBody: 'We love what you are building and would like to explore a co-marketing partnership.',
    read: true
  }
]

const SOURCE_URL = 'https://example.slack.com/archives/C0SUPPORT'

export const provider: SeedProvider = {
  id: 'triage',
  dependsOn: ['auth'],
  seed(ctx) {
    // Flow — the central triage entity (the FlowList landing surface).
    ctx.upsert('triage_flows', { id: flowId(ctx) }, {
      teamId: ctx.teamId,
      owner: 'seed',
      order: 0,
      name: 'Support Triage',
      description: 'Routes support discussions into actionable tasks.',
      availableDomains: null,
      aiEnabled: true,
      replyPersonality: 'Helpful, concise, and friendly.',
      personalityIcon: 'i-lucide-bot',
      active: true,
      onboardingComplete: true,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      createdBy: 'seed',
      updatedBy: 'seed'
    })

    // Input — a Slack source under the flow (demo display config; no live token).
    ctx.upsert('triage_inputs', { id: inputId(ctx) }, {
      teamId: ctx.teamId,
      owner: 'seed',
      order: 0,
      flowId: flowId(ctx),
      sourceType: 'slack',
      name: 'Support Channel',
      sourceMetadata: { channel: '#support' },
      active: true,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      createdBy: 'seed',
      updatedBy: 'seed'
    })

    // Discussions — incoming threads, analysed by AI.
    DISCUSSIONS.forEach((d, index) => {
      ctx.upsert('triage_discussions', { id: discussionId(ctx, d.key) }, {
        teamId: ctx.teamId,
        owner: 'seed',
        order: index,
        sourceType: 'slack',
        sourceThreadId: `seed-thread-${d.key}`,
        sourceUrl: `${SOURCE_URL}/p${index + 1}`,
        flowInputId: inputId(ctx),
        title: d.title,
        content: d.content,
        authorHandle: d.authorHandle,
        participants: [d.authorHandle, '@support'],
        status: d.status,
        threadData: {},
        totalMessages: d.totalMessages,
        aiSummary: d.aiSummary,
        aiKeyPoints: d.aiKeyPoints,
        aiTasks: {},
        isMultiTask: false,
        metadata: {},
        processedAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        createdBy: 'seed',
        updatedBy: 'seed'
      })
    })

    // Tasks — the actionable output, one per resolved discussion. The Notion
    // ids/urls are demo placeholders (no live Notion sync); `notionPageId` is
    // unique per team, so stable demo ids keep re-runs idempotent.
    TASKS.forEach((t, index) => {
      ctx.upsert('triage_tasks', { id: seedId('triage-task', ctx.teamSlug, t.discussionKey) }, {
        teamId: ctx.teamId,
        owner: 'seed',
        order: index,
        discussionId: discussionId(ctx, t.discussionKey),
        syncJobId: seedId('triage-job', ctx.teamSlug, t.discussionKey),
        notionPageId: `seed-notion-${t.discussionKey}`,
        notionPageUrl: `https://www.notion.so/seed-${t.discussionKey}`,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        summary: t.description,
        sourceUrl: `${SOURCE_URL}/p${index + 1}`,
        isMultiTaskChild: false,
        metadata: {},
        createdAt: ctx.now,
        updatedAt: ctx.now,
        createdBy: 'seed',
        updatedBy: 'seed'
      })
    })

    // Messages — a small inbox so the Inbox surface isn't empty.
    MESSAGES.forEach((m, index) => {
      ctx.upsert('triage_messages', { id: seedId('triage-message', ctx.teamSlug, m.key) }, {
        teamId: ctx.teamId,
        owner: 'seed',
        order: index,
        flowInputId: inputId(ctx),
        messageType: 'email',
        from: m.from,
        to: 'support@example.com',
        subject: m.subject,
        textBody: m.textBody,
        receivedAt: raw(`unixepoch() - ${(index + 1) * 3600}`),
        read: m.read,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        createdBy: 'seed',
        updatedBy: 'seed'
      })
    })
  }
}

export default provider
