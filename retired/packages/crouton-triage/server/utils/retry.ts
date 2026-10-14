/**
 * Retry utility with exponential backoff
 *
 * Provides simple retry logic for async operations that may fail temporarily.
 * Used throughout Crouton Triage for external API calls (Claude, Notion, Figma, Slack).
 *
 * @module retry
 */

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (including the first try)
   * @default 3
   */
  maxAttempts?: number

  /**
   * Base delay in milliseconds for exponential backoff
   * @default 1000 (1 second)
   */
  baseDelay?: number

  /**
   * Maximum delay in milliseconds (caps exponential backoff)
   * @default undefined (no cap)
   */
  maxDelay?: number

  /**
   * Timeout in milliseconds for each attempt
   * If an attempt takes longer than this, it will be aborted
   * @default undefined (no timeout)
   */
  timeout?: number

  /**
   * Optional callback invoked before each retry
   * Useful for logging retry attempts
   */
  onRetry?: (attempt: number, error: unknown) => void
}

/**
 * Delay helper function
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry an async function with exponential backoff and optional timeout
 *
 * Attempts to execute the provided function up to maxAttempts times.
 * On failure, waits with exponential backoff: 2s, 4s, 8s, etc.
 * Optionally enforces a timeout per attempt to prevent hanging.
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await retryWithBackoff(() => fetchData())
 *
 * // With timeout to prevent hanging
 * const result = await retryWithBackoff(
 *   () => callExternalAPI(),
 *   {
 *     maxAttempts: 3,
 *     baseDelay: 1000,
 *     timeout: 15000, // 15 second timeout per attempt
 *     onRetry: (attempt, error) => logger.debug(`Retry ${attempt}:`, error)
 *   }
 * )
 * ```
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's return value
 * @throws The last error if all attempts fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay,
    timeout,
    onRetry
  } = options

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // If timeout is specified, race the function against a timeout
      if (timeout) {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
          )
        ])
        return result
      } else {
        return await fn()
      }
    } catch (error) {
      lastError = error

      // If this was the last attempt, throw the error
      if (attempt === maxAttempts) {
        throw error
      }

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt, error)
      }

      // Calculate exponential backoff: 2^attempt * baseDelay
      // Attempt 1: 2^1 * 1000 = 2000ms (2s)
      // Attempt 2: 2^2 * 1000 = 4000ms (4s)
      // Attempt 3: 2^3 * 1000 = 8000ms (8s)
      let backoffMs = Math.pow(2, attempt) * baseDelay

      // Cap at maxDelay if specified
      if (maxDelay && backoffMs > maxDelay) {
        backoffMs = maxDelay
      }

      // Wait before next retry
      await delay(backoffMs)
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError
}

