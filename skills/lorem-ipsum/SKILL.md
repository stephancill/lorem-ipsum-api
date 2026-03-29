---
name: lorem-ipsum
description: Generate paid placeholder text from the lorem ipsum API endpoint. Use when an agent needs lorem ipsum words/sentences/paragraphs and must handle either MPP or x402 payment challenges.
---

Call `GET https://lorem.steer.fun/lorem`.

Use query parameters:
- `count` integer `1..50` (default `1`)
- `units` `words | sentences | paragraphs` (allow singular aliases)
- `format` `plain | html` (default `plain`)

Handle payment as follows:
- If response is `402` with `WWW-Authenticate`, complete MPP payment and retry.
- If response is `402` with `PAYMENT-REQUIRED`, complete x402 payment with `PAYMENT-SIGNATURE` and retry.
- Accept either protocol; the endpoint may return both challenges.

Use example requests:
- `GET /lorem?count=2&units=paragraphs&format=plain`
- `GET /lorem?count=5&units=sentences`

Validate errors:
- Treat `400` as invalid query parameters.
