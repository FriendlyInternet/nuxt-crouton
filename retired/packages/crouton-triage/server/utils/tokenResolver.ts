/**
 * Centralized token resolution for inputs and outputs.
 *
 * Resolves tokens from connected accounts (triageAccounts) when an accountId
 * is set, falling back to inline tokens for backward compatibility.
 *
 * Uses decryptSecret() from crouton-core (auto-imported by Nitro).
 */

import type { FlowInput, FlowOutput, NotionOutputConfig } from '../../app/types'

/**
 * Resolve the API token for an input source.
 *
 * Priority:
 * 1. If accountId is set → decrypt from connected account
 * 2. Else → fall back to input.apiToken (legacy inline token)
 */
export async function resolveInputToken(
  input: FlowInput,
  teamId: string,
): Promise<string> {
  // If accountId is set, resolve from the connected account
  if (input.accountId) {
    return resolveAccountToken(input.accountId, teamId)
  }

  // Fall back to inline token — decrypt if stored encrypted
  const token = input.apiToken || ''
  if (token && isEncryptedSecret(token)) {
    return decryptSecret(token)
  }
  return token
}

/**
 * Resolve the Notion token for an output destination.
 *
 * Priority:
 * 1. If accountId is set → decrypt from connected account
 * 2. Else → fall back to outputConfig.notionToken (legacy inline token)
 */
export async function resolveOutputToken(
  output: FlowOutput,
  teamId: string,
): Promise<string> {
  // If accountId is set, resolve from the connected account
  if (output.accountId) {
    return resolveAccountToken(output.accountId, teamId)
  }

  // Fall back to inline token — decrypt if stored encrypted
  const config = output.outputConfig as NotionOutputConfig
  const token = config?.notionToken || ''
  if (token && isEncryptedSecret(token)) {
    return decryptSecret(token)
  }
  return token
}

/**
 * Resolve and decrypt a token from a connected account record.
 *
 * @throws Error if account not found or token cannot be decrypted
 */
export async function resolveAccountToken(
  accountId: string,
  teamId: string,
): Promise<string> {
  const { getTriageAccountsByIds } = await import(
    '~~/layers/triage/collections/accounts/server/database/queries'
  )

  const accounts = await getTriageAccountsByIds(teamId, [accountId])
  const account = accounts[0]

  if (!account) {
    throw new Error(`Connected account ${accountId} not found for team ${teamId}`)
  }

  if (account.status !== 'connected') {
    throw new Error(`Connected account ${accountId} has status "${account.status}" — token may be invalid`)
  }

  if (!account.accessToken) {
    throw new Error(`Connected account ${accountId} has no access token`)
  }

  // Decrypt the stored token
  return decryptSecret(account.accessToken)
}
