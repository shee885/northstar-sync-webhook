import { createServerFn } from "@tanstack/react-start";

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  getWebhookSecret,
  signPayload,
  verifyWebhook,
} from "./northstar-webhook.server";

export type TestMode = "valid" | "tampered_body" | "wrong_secret" | "stale_timestamp" | "missing_headers";

export type TestResult = {
  mode: TestMode;
  headers: Record<string, string>;
  body: string;
  accepted: boolean;
  status: number;
  response: { code: string; message: string } | { code: "accepted"; message: string };
};

export const sendTestWebhook = createServerFn({ method: "POST" })
  .inputValidator((input: { mode: TestMode; body: string }) => input)
  .handler(async ({ data }): Promise<TestResult> => {
    const secret = getWebhookSecret();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const timestamp = data.mode === "stale_timestamp" ? String(nowSeconds - 900) : String(nowSeconds);
    const signingSecret = data.mode === "wrong_secret" ? "not-the-real-secret" : secret;
    const signedBody = data.body;
    const sentBody =
      data.mode === "tampered_body"
        ? data.body.replace(/"quantity"\s*:\s*\d+/, '"quantity": 9999')
        : data.body;

    const signature = signPayload(timestamp, signedBody, signingSecret);
    const missing = data.mode === "missing_headers";

    const headers: Record<string, string> = missing
      ? { "content-type": "application/json" }
      : {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        };

    const result = verifyWebhook({
      rawBody: sentBody,
      signature: missing ? null : signature,
      timestamp: missing ? null : timestamp,
      secret,
      nowSeconds,
    });

    if (result.ok) {
      return {
        mode: data.mode,
        headers,
        body: sentBody,
        accepted: true,
        status: 200,
        response: {
          code: "accepted",
          message: `Stock for ${result.event.sku} at ${result.event.location} set to ${result.event.quantity}.`,
        },
      };
    }

    return {
      mode: data.mode,
      headers,
      body: sentBody,
      accepted: false,
      status: result.status,
      response: { code: result.code, message: result.message },
    };
  });
