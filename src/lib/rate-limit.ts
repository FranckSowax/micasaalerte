/**
 * Wait for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on 429 (rate limit) errors.
 * Waits progressively longer between retries.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 1500
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelay * attempt;
      await sleep(delay);
    }

    const response = await fetch(url, options);

    if (response.status === 429 && attempt < maxRetries) {
      continue;
    }

    return response;
  }

  throw new Error("Max retries exceeded for rate limit");
}
