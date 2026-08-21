import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { sendTestWebhook, type TestMode, type TestResult } from "@/lib/northstar-webhook.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Northstar Inventory Webhook Verifier" },
      {
        name: "description",
        content:
          "Prototype console for Northstar Retail Co.: sign, send and verify HMAC-secured inventory sync webhooks before they reach the support tool.",
      },
      { property: "og:title", content: "Northstar Inventory Webhook Verifier" },
      {
        property: "og:description",
        content:
          "Test HMAC-SHA256 signature verification and replay protection for Northstar's live inventory sync webhooks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const DEFAULT_BODY = JSON.stringify(
  {
    event: "inventory.updated",
    sku: "NS-4471-BLK",
    location: "store-014-portland",
    quantity: 12,
    updated_at: new Date("2026-08-21T18:40:00Z").toISOString(),
  },
  null,
  2,
);

const MODES: { mode: TestMode; label: string; hint: string }[] = [
  { mode: "valid", label: "Valid delivery", hint: "Correct secret, fresh timestamp" },
  { mode: "tampered_body", label: "Tampered body", hint: "Quantity rewritten in transit" },
  { mode: "wrong_secret", label: "Wrong secret", hint: "Signed by an unknown sender" },
  { mode: "stale_timestamp", label: "Replayed request", hint: "Timestamp 15 minutes old" },
  { mode: "missing_headers", label: "Missing headers", hint: "No signature or timestamp" },
];

function Index() {
  const [body, setBody] = useState(DEFAULT_BODY);
  const [log, setLog] = useState<TestResult[]>([]);
  const send = useServerFn(sendTestWebhook);

  const mutation = useMutation({
    mutationFn: (mode: TestMode) => send({ data: { mode, body } }),
    onSuccess: (result) => setLog((prev) => [result, ...prev].slice(0, 6)),
  });

  return (
    <main className="min-h-screen bg-background px-6 py-14 text-foreground">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Northstar Retail Co. · Sprint 2
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Inventory sync webhook verification
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every stock update that feeds the support tool&rsquo;s &ldquo;is this in stock?&rdquo; answer must
          prove it came from Northstar&rsquo;s inventory service. This prototype signs a payload with
          HMAC-SHA256 over <code className="font-mono text-accent">timestamp.body</code>, then runs it through
          the same verifier the live endpoint uses.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Event payload
            </h2>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
              rows={12}
              aria-label="Webhook JSON payload"
              className="mt-3 w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-accent"
            />
            <div className="mt-4 space-y-2">
              {MODES.map(({ mode, label, hint }) => (
                <Button
                  key={mode}
                  variant={mode === "valid" ? "default" : "outline"}
                  className="h-auto w-full justify-between px-4 py-3 text-left"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(mode)}
                >
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-[11px] opacity-70">{hint}</span>
                </Button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Verification log
            </h2>
            {log.length === 0 ? (
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                Send a delivery to see the signed headers and the verifier&rsquo;s decision.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {log.map((entry, index) => (
                  <li
                    key={`${entry.mode}-${index}`}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{entry.mode}</span>
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                          entry.accepted
                            ? "bg-accent/15 text-accent"
                            : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {entry.status} {entry.response.code}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed">{entry.response.message}</p>
                    <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {Object.entries(entry.headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join("\n")}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="mt-10 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Live endpoint contract
          </h2>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
{`POST /api/public/northstar/inventory-webhook
x-northstar-timestamp: <unix seconds>
x-northstar-signature: sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")

200 { "code": "accepted", "event": { ... } }
401 invalid_signature | stale_timestamp | missing_headers
400 bad_timestamp | invalid_json
422 invalid_payload`}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Timestamps outside a 300-second window are rejected as replays, and signatures are compared in
            constant time. The shared secret lives only on the server as{" "}
            <code className="font-mono text-accent">NORTHSTAR_WEBHOOK_SECRET</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
