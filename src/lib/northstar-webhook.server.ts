import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-northstar-signature";
export const TIMESTAMP_HEADER = "x-northstar-timestamp";
export const TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true; event: InventoryEvent }
  | { ok: false; status: number; code: string; message: string };

export type InventoryEvent = {
  event: string;
  sku: string;
  location: string;
  quantity: number;
  updated_at: string;
};

export function getWebhookSecret(): string {
  const secret = process.env["NORTHSTAR_WEBHOOK_SECRET"];
  if (!secret) throw new Error("NORTHSTAR_WEBHOOK_SECRET is not configured");
  return secret;
}

/** Signature covers `${timestamp}.${rawBody}` so a body can't be replayed with a new time. */
export function signPayload(timestamp: string, rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowSeconds?: number;
}): VerifyResult {
  const { rawBody, signature, timestamp, secret } = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!signature || !timestamp) {
    return {
      ok: false,
      status: 401,
      code: "missing_headers",
      message: `Both ${SIGNATURE_HEADER} and ${TIMESTAMP_HEADER} are required.`,
    };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 400, code: "bad_timestamp", message: "Timestamp is not a unix time." };
  }

  const skew = Math.abs(now - ts);
  if (skew > TOLERANCE_SECONDS) {
    return {
      ok: false,
      status: 401,
      code: "stale_timestamp",
      message: `Timestamp is ${skew}s off; tolerance is ${TOLERANCE_SECONDS}s (replay protection).`,
    };
  }

  const expected = signPayload(timestamp, rawBody, secret);
  if (!safeEqual(signature, expected)) {
    return {
      ok: false,
      status: 401,
      code: "invalid_signature",
      message: "HMAC-SHA256 signature does not match the request body.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "invalid_json", message: "Body is not valid JSON." };
  }

  const candidate = parsed as Partial<InventoryEvent>;
  if (
    typeof candidate?.sku !== "string" ||
    typeof candidate?.location !== "string" ||
    typeof candidate?.quantity !== "number"
  ) {
    return {
      ok: false,
      status: 422,
      code: "invalid_payload",
      message: "Expected sku (string), location (string) and quantity (number).",
    };
  }

  return {
    ok: true,
    event: {
      event: typeof candidate.event === "string" ? candidate.event : "inventory.updated",
      sku: candidate.sku,
      location: candidate.location,
      quantity: candidate.quantity,
      updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : new Date().toISOString(),
    },
  };
}
