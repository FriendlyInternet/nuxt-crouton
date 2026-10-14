import { eq } from 'drizzle-orm'

export async function findFlowInputByEmailAddress(emailAddress: string) {
  const db = useDB()
  const { triageInputs } = await import('~~/layers/triage/collections/inputs/server/database/schema')
  const { triageFlows } = await import('~~/layers/triage/collections/flows/server/database/schema')

  const [result] = await db
    .select()
    .from(triageInputs)
    .leftJoin(triageFlows, eq(triageInputs.flowId, triageFlows.id))
    .where(eq(triageInputs.emailAddress, emailAddress))
    .limit(1)

  if (!result) return null
  return { ...result.triage_inputs, flowIdData: result.triage_flows }
}
