/**
 * Testprint (#1391): enqueue a tiny test ticket for ONE printer through the
 * REAL print flow — generic `print_jobs` queue, delivered by whatever
 * transport the event's Print flow selects (router spooler / local drainer).
 * One tap proves routing + transport + paper, without placing a fake order.
 *
 * Refuses (409) when the event's flow is 'none' (no physical printing) — an
 * enqueued job would sit pending forever, which reads as a broken printer.
 * `refType: 'test'` keeps it out of the order auto-complete reactions (they
 * act on refType 'order' only).
 *
 * Thin shell by design: the lookups live in requireTeamEvent /
 * requireEventPrinter, the job assembly in buildTestPrintJob (pure, tested).
 * `encodeTicket` / `enqueuePrintJob` are crouton-printing nitro globals.
 */
import { PRINT_TRANSPORT, getPrintTransport } from '@fyit/crouton-printing/server/utils/print-transport'
import { requireTeamEvent } from '../../../../../../../../utils/team-event'
import { requireEventPrinter } from '../../../../../../../../utils/event-printer'
import { buildTestPrintJob } from '../../../../../../../../utils/test-print'

export default defineEventHandler(async (event) => {
  const { team, user, db, eventId, salesEvent } = await requireTeamEvent(event)
  const printer = await requireEventPrinter(db, event, eventId)

  // 'none' = no physical printing: refuse loudly instead of queueing a job
  // nothing will ever deliver.
  const transportRow = await getPrintTransport(db, eventId)
  if (transportRow?.transport === PRINT_TRANSPORT.NONE) {
    throw createError({
      status: 409,
      statusText: 'Print flow is set to no physical printing — pick a flow first'
    })
  }

  const { receipt, job } = buildTestPrintJob(printer, {
    eventId,
    teamId: team.id,
    teamName: team.name,
    eventName: salesEvent.title,
    user
  })
  const queueId = await enqueuePrintJob(db, { ...job, payload: encodeTicket(receipt, job.driver) })
  return { queueId }
})
