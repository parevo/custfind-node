import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

/**
 * Verifies a webhook delivery and returns its event. Pass the raw request
 * body exactly as received (a string or Buffer, before JSON parsing), the
 * Custfind-Signature header and your endpoint's whsec_ secret. Narrow the
 * result on `type` for typed `data`. Deliveries can repeat: use `id` to
 * handle each event once.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
): WebhookEvent {
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of (signatureHeader ?? "").split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") timestamp = Number(v);
    if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) throw new WebhookVerificationError("malformed Custfind-Signature header");
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) throw new WebhookVerificationError("timestamp outside tolerance");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  const ok = signatures.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookVerificationError("signature mismatch");
  return JSON.parse(body) as WebhookEvent;
}
