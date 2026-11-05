/** An error response from the Custfind API, or a request that never got one. */
export class CustfindError extends Error {
  /** HTTP status, or 0 when there was no response (network, timeout). */
  readonly status: number;
  /** The API's error code, e.g. "api_requires_paid_plan", "customer_limit_reached". */
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message?: string, retryAfter?: number) {
    super(message ?? (status ? `Custfind API error ${status}: ${code}` : `Custfind request failed: ${code}`));
    this.name = "CustfindError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** A webhook delivery that did not verify. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
