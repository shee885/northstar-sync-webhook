import { createFileRoute } from "@tanstack/react-router";

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  getWebhookSecret,
  verifyWebhook,
} from "@/lib/northstar-webhook.server";

export const Route = createFileRoute("/api/public/northstar/inventory-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const result = verifyWebhook({
          rawBody,
          signature: request.headers.get(SIGNATURE_HEADER),
          timestamp: request.headers.get(TIMESTAMP_HEADER),
          secret: getWebhookSecret(),
        });

        if (!result.ok) {
          console.warn(`northstar webhook rejected: ${result.code}`);
          return Response.json({ code: result.code, message: result.message }, { status: result.status });
        }

        // Prototype: verified events are logged only. Persist them when the
        // real inventory store is wired up.
        console.info("northstar webhook accepted", result.event);
        return Response.json({ code: "accepted", event: result.event });
      },
    },
  },
});
