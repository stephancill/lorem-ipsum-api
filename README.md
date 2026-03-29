# lorem-ipsum-api

Hono API running on Cloudflare Workers (Wrangler) that serves generated lorem ipsum text.

## Install dependencies

```bash
bun install
```

## Run locally (Wrangler)

```bash
bun run dev
```

Visit `http://127.0.0.1:8787`.

## API

- `GET /`
- `GET /generate?count=2&units=paragraphs&format=plain`

`/generate` supports both MPP and x402 paywalls. Unpaid requests return `402 Payment Required` with both protocol challenges.

## Static files

Files in `static/` are served directly by the Worker via the Cloudflare assets binding.

- `GET /` and `GET /llms.txt` both return `static/llms.txt`
- You can add arbitrary files under `static/` and request them by path

Query params:

- `count`: integer from `1` to `50` (default `1`)
- `units`: `words`, `sentences`, `paragraphs` (singular forms also accepted)
- `format`: `plain` or `html`

## MPP paywall config

Configure these variables in `.dev.vars` for local development and as Worker vars/secrets in Cloudflare:

- `MPP_SECRET_KEY` (required, no default)
- `MPP_AMOUNT` (default `0.001`)
- `MPP_DECIMALS` (default `6`)
- `MPP_CURRENCY` (default `0x20c0000000000000000000000000000000000000` for pathUSD)
- `MPP_RECIPIENT` (required, no default)

`MPP_SECRET_KEY` and `MPP_RECIPIENT` are required. If either is missing, the API returns `500` for `/generate`.

## x402 config

- `X402_FACILITATOR_URL` (default `https://facilitator.payai.network`)
- `X402_NETWORK` (default `eip155:8453`)
- `X402_PRICE` (default `$0.001`)
- `X402_PAY_TO` (optional; defaults to `MPP_RECIPIENT`)

On unpaid `/generate` requests, the API returns both `WWW-Authenticate` (MPP) and `PAYMENT-REQUIRED` (x402) headers. Use either protocol and retry the same request with `Payment-Receipt` (MPP) or `PAYMENT-SIGNATURE` (x402).

Test payment flow with `mppx` CLI:

```bash
bunx mppx --inspect "http://127.0.0.1:8787/generate"
bunx mppx "http://127.0.0.1:8787/generate?count=2&units=paragraphs&format=plain"
```

If no MPP wallet is configured yet, use Tempo skill setup: `https://tempo.xyz/SKILL`.

Test x402 flow with the helper script:

```bash
bun --env-file=.env.local run x402:request -- "http://127.0.0.1:8787/generate?count=2&units=paragraphs&format=plain"
```

## Deploy

```bash
bun run deploy
```
