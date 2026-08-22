# Learning & Blocker Journal — Northstar Inventory Webhook Verifier

**Sprint 2 · Northstar Retail Co.**
Kept by: junior developer, first time building a signed-webhook receiver.
Goal: make sure every stock update reaching the support tool provably came from Northstar's inventory service.

---

## 1. Resources consulted

| # | Resource | Why I opened it | What I actually took from it |
|---|---|---|---|
| 1 | Stripe webhook signature docs | Best-documented public example of HMAC webhooks | The signed string must be `timestamp.rawBody`, not just the body — that's what stops replay attacks |
| 2 | GitHub webhook docs (`X-Hub-Signature-256`) | Second opinion on header naming | Prefix the digest with `sha256=` so the algorithm is self-describing and upgradeable |
| 3 | Node.js `crypto` docs — `createHmac`, `timingSafeEqual` | Needed the exact API shape | `timingSafeEqual` throws if the two buffers differ in length, so length must be checked first |
| 4 | OWASP "Webhook Security" / API Security cheat sheets | Wanted to know what a reviewer would look for | Constant-time comparison, timestamp tolerance window, reject-by-default, never log the secret |
| 5 | TanStack Start server-routes docs | Where does a public HTTP endpoint live in this stack? | `src/routes/api/public/*` bypasses site auth, so auth must be implemented *inside* the handler |
| 6 | MDN — `Request.text()`, `Response.json()` | Body handling in a Web-standard runtime | Read the body **once** as raw text; `request.json()` destroys the exact bytes the signature covers |
| 7 | RFC 2104 (HMAC) — skimmed | Wanted to know *why* HMAC and not plain SHA-256 | Plain `hash(secret + body)` is length-extension vulnerable; HMAC's nested construction isn't |
| 8 | Cloudflare Workers runtime compatibility notes | The backend runs at the edge | `node:crypto` HMAC is available; don't reach for Node-only libraries |

---

## 2. Blocker log

### Blocker 1 — Every signature mismatched, even valid ones
**Error observed**
```
POST /api/public/northstar/inventory-webhook 401
{"code":"invalid_signature","message":"HMAC-SHA256 signature does not match the request body."}
```
**What I tried first:** assumed my secret was wrong, regenerated it. No change.

**Diagnosis:** I was calling `await request.json()` to inspect the payload, then re-stringifying it to verify. `JSON.stringify` reordered keys and dropped whitespace, so I was hashing *different bytes* than the sender signed.

**Resolution (unsupervised):** logged the byte length of the sender's body vs. mine — 214 vs. 187 — which pointed straight at re-serialization. Switched to `const rawBody = await request.text()` and only parsed **after** verification succeeded.

**Lesson:** verify the bytes on the wire, parse later. Never round-trip a payload before checking its signature.

---

### Blocker 2 — `timingSafeEqual` crashed the endpoint with a 500
**Error observed**
```
RangeError: Input buffers must have the same byte length
    at safeEqual (src/lib/northstar-webhook.server.ts)
```
**Trigger:** sending a request with a deliberately truncated signature header.

**Diagnosis:** the function only accepts equal-length buffers, and an attacker fully controls the header length — so any malformed header became a crash instead of a clean rejection.

**Resolution:** compared `Buffer.length` first and returned `false` on mismatch before calling `timingSafeEqual`. Length is not a secret, so leaking it via an early return is safe; the *content* comparison stays constant-time.

**Lesson:** hostile input reaches security code first. Guard the crypto primitive's preconditions.

---

### Blocker 3 — I nearly used `===` to compare signatures
**How I caught it:** the OWASP cheat sheet mentioned timing attacks; I didn't believe a few nanoseconds could matter and searched for a demonstration.

**What I learned:** `===` short-circuits on the first differing byte, so response time leaks how many leading bytes were correct. With enough requests an attacker can forge a signature byte by byte.

**Resolution:** kept the comparison in `timingSafeEqual` and wrote a comment explaining *why*, so nobody "simplifies" it later.

---

### Blocker 4 — A replayed request was accepted
**Test:** captured a valid delivery and re-sent the identical body and headers 20 minutes later. It returned `200 accepted`.

**Diagnosis:** the signature was still perfectly valid — that's the point of a signature. Signature validity says nothing about *freshness*.

**Resolution:** included the timestamp in the signed string and rejected requests whose timestamp is more than **300 seconds** from server time:
```
401 {"code":"stale_timestamp","message":"Timestamp is 900s off; tolerance is 300s (replay protection)."}
```
Used `Math.abs(now - ts)` so clocks that run *ahead* are caught too.

**Open follow-up:** a within-window replay is still possible. Real fix is storing delivery IDs and rejecting duplicates — noted for Sprint 3, needs the inventory store.

---

### Blocker 5 — `process.env.NORTHSTAR_WEBHOOK_SECRET` was `undefined`
**Error observed**
```
Error: NORTHSTAR_WEBHOOK_SECRET is not configured
```
It worked in one place and not another.

**Diagnosis:** I read the env var at module scope. Environment injection happens at *call* time in this runtime, so at import time the value didn't exist yet.

**Resolution:** moved the read into a `getWebhookSecret()` function invoked inside the handler, and made it throw a named error rather than silently signing with `undefined` (which would have made *every* signature "match" a wrong secret).

**Lesson:** fail loudly on missing secrets. A silent fallback in security code is worse than a crash.

---

### Blocker 6 — The test UI leaked the secret to the browser
**What happened:** my first version of the test console computed the HMAC in React so I could show the header on screen. It worked — and shipped the shared secret into the client bundle.

**How I caught it:** searched the built client output for a fragment of the secret and found it.

**Resolution:** moved all signing into a server function (`sendTestWebhook`) and returned only the resulting headers to the UI. The browser now sees the signature, never the key.

**Lesson:** if the browser can compute a signature, the secret isn't secret.

---

### Blocker 7 — My public endpoint was behind the site's auth wall
**Symptom:** curl from outside got an auth redirect instead of my handler; it worked fine in the preview because I was already signed in.

**Diagnosis:** only routes under `api/public/` are exempt from site auth.

**Resolution:** moved the file to `src/routes/api/public/northstar/inventory-webhook.ts` — and immediately added a note to myself that "public" means *I* am now the only thing authenticating the caller, which is exactly what the signature check is for.

---

### Blocker 8 — Rejections were unhelpful to debug
**Symptom:** everything failed with a flat `401 Unauthorized`, so I couldn't tell a bad secret from a stale timestamp.

**Resolution:** gave each failure a distinct machine code — `missing_headers`, `bad_timestamp`, `stale_timestamp`, `invalid_signature`, `invalid_json`, `invalid_payload` — with correct statuses (401 auth, 400 malformed, 422 semantically wrong). Kept messages descriptive but free of secret material, and logged rejections server-side by code only.

---

## 3. How I unblocked myself without supervision

1. **Reproduce deliberately.** I built the five-button test console (valid / tampered body / wrong secret / replay / missing headers) *before* debugging. A one-click repro turned guessing into measuring.
2. **Compare the two sides.** Nearly every HMAC bug is "the signer and verifier disagree about the exact input string." Logging the byte length and the signed string shape — never the secret — found Blockers 1 and 4 fast.
3. **Read the primary source, not the blog post.** Node's `crypto` docs and the framework's own routing docs answered in minutes what tutorials got wrong.
4. **Cross-check two real implementations.** Stripe and GitHub agreeing on a pattern was strong evidence it was the right pattern.
5. **Treat every error as a security question.** "Why did this fail?" then "what would an attacker do with this failure mode?" That second question produced the length guard and the loud-secret-failure change.
6. **Write the lesson down immediately.** Each entry above got its `Why:` comment in the code, so the next person doesn't undo the fix.

---

## 4. Current state and known gaps

**Working**
- HMAC-SHA256 over `timestamp.rawBody`, constant-time comparison, `sha256=` prefixed digest
- 300-second replay window, absolute skew
- Typed rejection codes with correct HTTP statuses
- Payload shape validation (`sku`, `location`, `quantity`)
- Secret server-only, read at call time, fails loudly

**Not done yet (Sprint 3 candidates)**
- Delivery-ID deduplication for within-window replays
- Persisting verified events to a real inventory store (currently logged only)
- Rate limiting on the public endpoint
- Secret rotation with an overlap period (accept old + new during rollover)
- Automated tests for each rejection path, run in CI
