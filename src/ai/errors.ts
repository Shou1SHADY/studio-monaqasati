export class OpenRouterRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfter: number) {
    super(`OpenRouter rate limit — retry after ${retryAfter}s`);
    this.retryAfterSeconds = retryAfter;
  }
}
