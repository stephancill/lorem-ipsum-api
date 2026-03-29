---
name: lorem-ipsum
description: Generate paid placeholder text from the lorem ipsum API endpoint. Use when an agent needs lorem ipsum words/sentences/paragraphs and must handle either MPP or x402 payment challenges.
---

Call `GET https://lorem.steer.fun/generate`.
Use `GET https://lorem.steer.fun/openapi.json` for MPP discovery metadata.

Use query parameters:
- `count` integer `1..50` (default `1`)
- `units` `words | sentences | paragraphs` (allow singular aliases)
- `format` `plain | html` (default `plain`)

Handle payment as follows:
- On unpaid requests, the API returns `402` with both protocol challenges:
  - `WWW-Authenticate` (MPP)
  - `PAYMENT-REQUIRED` (x402)
- Use either protocol and retry the same request:
  - MPP path: pay and return `Payment-Receipt`
  - x402 path: pay and return `PAYMENT-SIGNATURE`
- If no MPP wallet is available, use Tempo skill setup first: https://tempo.xyz/SKILL

Use example requests:
- `GET /generate?count=2&units=paragraphs&format=plain`
- `GET /generate?count=5&units=sentences`

Validate errors:
- Treat `400` as invalid query parameters.
