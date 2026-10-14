/**
 * Domain Routing Utility
 *
 * Implements AI domain-based routing to determine which outputs should receive
 * a task based on the task's detected domain and the output's domain filters.
 *
 * **Routing Logic:**
 * 1. If task.domain matches an output's domainFilter → route to that output
 * 2. If task.domain is null/undefined → route to default output only
 * 3. If task.domain matches multiple outputs → create in all matching outputs
 * 4. If task.domain matches no outputs → route to default output
 * 5. If no default output configured → throw error
 */

import type { DetectedTask, FlowOutput } from '../../app/types'
import { logger } from './logger'

/**
 * Route a task to matching outputs based on domain
 *
 * @param task - The detected task with optional domain field
 * @param outputs - All active outputs for the flow
 * @returns Array of outputs that should receive this task
 * @throws Error if no default output is configured and task doesn't match any output
 */
export function routeTaskToOutputs(
  task: DetectedTask,
  outputs: FlowOutput[],
): FlowOutput[] {
  logger.debug('Routing task to outputs', {
    taskDomain: task.domain,
    outputCount: outputs.length,
  })

  // Find default output
  const defaultOutput = outputs.find(output => output.isDefault)

  if (!defaultOutput) {
    logger.error('No default output configured for flow', {
      outputCount: outputs.length,
      taskDomain: task.domain,
    })
    throw new Error(
      'Flow configuration error: No default output configured. ' +
      'Every flow must have one output marked as default.'
    )
  }

  // If task has no domain (null/undefined), route to default only
  if (!task.domain) {
    logger.info('Task has no domain, routing to default output', {
      defaultOutputId: defaultOutput.id,
      defaultOutputType: defaultOutput.outputType,
    })
    return [defaultOutput]
  }

  // Find all outputs with matching domain filters
  const matchingOutputs = outputs.filter(output => {
    // Skip if output has no domain filter (it's likely the default catch-all)
    if (!output.domainFilter || output.domainFilter.length === 0) {
      return false
    }

    // Check if task domain matches any of the output's domain filters
    const matches = output.domainFilter.includes(task.domain!)

    if (matches) {
      logger.debug('Task domain matches output', {
        taskDomain: task.domain,
        outputId: output.id,
        outputType: output.outputType,
        domainFilter: output.domainFilter,
      })
    }

    return matches
  })

  // If we found matching outputs, use them
  if (matchingOutputs.length > 0) {
    logger.info('Task routed to matching domain outputs', {
      taskDomain: task.domain,
      matchCount: matchingOutputs.length,
      outputTypes: matchingOutputs.map(o => o.outputType),
    })
    return matchingOutputs
  }

  // No matches found, use default output
  logger.info('Task domain did not match any output, routing to default', {
    taskDomain: task.domain,
    defaultOutputId: defaultOutput.id,
    defaultOutputType: defaultOutput.outputType,
  })

  return [defaultOutput]
}

/**
 * Validate flow outputs configuration
 *
 * Ensures the flow has at least one default output.
 * Should be called when creating/updating flows.
 *
 * @param outputs - All outputs for a flow
 * @throws Error if validation fails
 */
export function validateFlowOutputs(outputs: FlowOutput[]): void {
  if (outputs.length === 0) {
    throw new Error('Flow must have at least one output')
  }

  const defaultOutputs = outputs.filter(o => o.isDefault)

  if (defaultOutputs.length === 0) {
    throw new Error(
      'Flow must have exactly one default output. ' +
      'Mark one output as default (isDefault: true).'
    )
  }

  if (defaultOutputs.length > 1) {
    logger.warn('Multiple default outputs found, using first one', {
      defaultCount: defaultOutputs.length,
      defaultOutputIds: defaultOutputs.map(o => o.id),
    })
  }
}
