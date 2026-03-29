# Skill: lorem-ipsum

Use this skill when you need paid placeholder text from the lorem-ipsum API.

## Base URL

- `https://lorem.steer.fun`

## Endpoint

- `GET /lorem`

Query params:

- `count` integer `1..50` (default `1`)
- `units` `words | sentences | paragraphs` (singular allowed)
- `format` `plain | html` (default `plain`)

## Payment

- This endpoint requires payment and supports both protocols:
  - MPP (`WWW-Authenticate` / `Payment-Receipt`)
  - x402 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`)

## Examples

- `GET /lorem?count=2&units=paragraphs&format=plain`
- `GET /lorem?count=5&units=sentences`

## Notes

- Unpaid requests return `402 Payment Required` with both challenges.
- Invalid query params return `400` with a JSON error body.
