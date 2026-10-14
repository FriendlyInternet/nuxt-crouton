export interface FeedItem {
  id: string
  sourceType: string
  sourceUrl?: string
  title: string
  authorHandle: string
  totalMessages: number
  status: string
  timestamp: Date
  aiSummary?: string
  aiKeyPoints?: string[]
  tasks: Array<{
    id: string
    title: string
    externalUrl?: string
    status: string
  }>
  processingTime?: number
  error?: string
  discussionId: string
}

export async function useTriageFeed(options?: { limit?: number }) {
  const { currentTeam } = useTeam()

  // Fetch discussions, jobs, and tasks (all at once to preserve Nuxt async context)
  const [
    { items: discussions, pending: discussionsPending, refresh: refreshDiscussions },
    { items: jobs, pending: jobsPending, refresh: refreshJobs },
    { items: tasks, pending: tasksPending, refresh: refreshTasks },
  ] = await Promise.all([
    useCollectionQuery('triageDiscussions'),
    useCollectionQuery('triageJobs'),
    useCollectionQuery('triageTasks'),
  ])

  const loading = computed(() => discussionsPending.value || jobsPending.value || tasksPending.value)

  // Build job lookup by discussion ID
  const jobsByDiscussion = computed(() => {
    const map = new Map<string, any>()
    for (const job of (jobs.value || [])) {
      if (job.discussionId) {
        // Keep the most recent job per discussion
        const existing = map.get(job.discussionId)
        if (!existing || new Date(job.createdAt) > new Date(existing.createdAt)) {
          map.set(job.discussionId, job)
        }
      }
    }
    return map
  })

  // Build task lookup by ID
  const tasksById = computed(() => {
    const map = new Map<string, any>()
    for (const task of (tasks.value || [])) {
      map.set(task.id, task)
    }
    return map
  })

  // Parse AI data from discussion fields
  function parseAiData(discussion: any): { summary?: string; keyPoints?: string[] } {
    try {
      if (discussion.aiSummary) {
        const parsed = typeof discussion.aiSummary === 'string'
          ? JSON.parse(discussion.aiSummary)
          : discussion.aiSummary
        return {
          summary: parsed.summary || parsed,
          keyPoints: parsed.keyPoints || []
        }
      }
    }
    catch {}
    return {}
  }

  // Join data into feed items
  const feedItems = computed<FeedItem[]>(() => {
    const allDiscussions = discussions.value || []
    const limit = options?.limit ?? 50

    const items = allDiscussions
      .map((discussion: any) => {
        const job = jobsByDiscussion.value.get(discussion.id)
        const aiData = parseAiData(discussion)

        // Resolve task IDs to task objects
        const taskIds = discussion.notionTaskIds || job?.taskIds || []
        const resolvedTasks = (Array.isArray(taskIds) ? taskIds : [])
          .map((taskId: string) => {
            const task = tasksById.value.get(taskId)
            return task
              ? { id: task.id, title: task.title, externalUrl: task.externalUrl, status: task.status }
              : { id: taskId, title: 'Task', status: 'unknown' }
          })

        // Parse thread data for message count
        let totalMessages = 1
        try {
          const threadData = typeof discussion.threadData === 'string'
            ? JSON.parse(discussion.threadData)
            : discussion.threadData
          if (threadData?.replies) {
            totalMessages = 1 + threadData.replies.length
          }
        }
        catch {}

        return {
          id: discussion.id,
          sourceType: discussion.sourceType || 'unknown',
          sourceUrl: discussion.sourceUrl,
          title: discussion.title || 'Untitled discussion',
          authorHandle: discussion.authorHandle || 'unknown',
          totalMessages,
          status: job?.status || discussion.status || 'pending',
          timestamp: new Date(discussion.createdAt || Date.now()),
          aiSummary: aiData.summary,
          aiKeyPoints: aiData.keyPoints,
          tasks: resolvedTasks,
          processingTime: job?.processingTime,
          error: job?.error,
          discussionId: discussion.id,
        } satisfies FeedItem
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit)

    return items
  })

  async function refresh() {
    await Promise.all([refreshDiscussions(), refreshJobs(), refreshTasks()])
  }

  return {
    feedItems,
    loading,
    refresh,
  }
}
