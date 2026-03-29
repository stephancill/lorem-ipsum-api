import { Hono } from "hono";
import { loremIpsum } from "lorem-ipsum";
import { Mppx, tempo } from "mppx/server";
import { isAddress } from "viem";
import { z } from "zod";

type Bindings = {
	MPP_AMOUNT?: string;
	MPP_CURRENCY?: string;
	MPP_DECIMALS?: string;
	MPP_RECIPIENT?: string;
	MPP_SECRET_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const ALLOWED_UNITS = ["words", "sentences", "paragraphs"] as const;
const ALLOWED_FORMATS = ["plain", "html"] as const;

type AllowedUnit = (typeof ALLOWED_UNITS)[number];
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

const ALLOWED_UNITS_SET = new Set<string>(ALLOWED_UNITS);
const ALLOWED_FORMATS_SET = new Set<string>(ALLOWED_FORMATS);
const MAX_COUNT = 50;
const DEFAULT_PRICE_AMOUNT = "0.001";
const DEFAULT_PRICE_DECIMALS = 6;
const DEFAULT_PATH_USD = "0x20c0000000000000000000000000000000000000";

const EnvSchema = z.object({
	MPP_SECRET_KEY: z.string().min(1),
	MPP_RECIPIENT: z.string().refine((value) => isAddress(value), {
		message: "MPP_RECIPIENT must be a valid Ethereum address.",
	}),
	MPP_AMOUNT: z.string().min(1).default(DEFAULT_PRICE_AMOUNT),
	MPP_DECIMALS: z.coerce.number().int().nonnegative().default(DEFAULT_PRICE_DECIMALS),
	MPP_CURRENCY: z.string().min(1).default(DEFAULT_PATH_USD),
});

const createPaymentHandler = (env: z.infer<typeof EnvSchema>, realm: string) => {
	return Mppx.create({
		realm,
		secretKey: env.MPP_SECRET_KEY,
		methods: [
			tempo.charge(),
		],
	});
};

const normalizeUnits = (value: string): AllowedUnit | string => {
	if (value === "word") return "words";
	if (value === "sentence") return "sentences";
	if (value === "paragraph") return "paragraphs";
	return value;
};

app.get("/", (c) => {
	return c.json({
		message: "Lorem Ipsum API on Hono + Cloudflare Workers",
		endpoint: "/lorem?count=2&units=paragraphs&format=plain",
		paywall: "MPP 402 payment required on /lorem",
	});
});

app.get("/llms.txt", (c) => {
	return c.text(`Lorem Ipsum API

Overview
- This API generates placeholder lorem ipsum text.
- Base URL is the current origin; all paths below are relative.
- The /lorem endpoint is payment-gated using MPP (HTTP 402).

Endpoints
1. GET /
   - Returns service metadata as JSON.

2. GET /lorem
   - Paid endpoint.
   - Generates lorem ipsum text.
   - Query parameters:
     - count: integer, 1..50 (default: 1)
     - units: words | sentences | paragraphs (singular also accepted)
     - format: plain | html (default: plain)
   - If unpaid/invalid credential: returns HTTP 402 with WWW-Authenticate challenge.
   - If paid: returns JSON with count, units, format, and text plus Payment-Receipt header.

Examples
- /lorem
- /lorem?count=3&units=sentences
- /lorem?count=2&units=paragraphs&format=html

MPP payment config (server-side)
- MPP_AMOUNT (default: 0.001)
- MPP_DECIMALS (default: 6)
- MPP_CURRENCY (default: 0x20c0000000000000000000000000000000000000)
- MPP_RECIPIENT (required, no default)
- MPP_SECRET_KEY (required, no default)

Paying from CLI
- mppx --inspect /lorem
- mppx /lorem?count=2&units=paragraphs

Errors
- Returns HTTP 400 for invalid query parameters.
`);
});

app.get("/lorem", async (c) => {
	const envResult = EnvSchema.safeParse(c.env);
	if (!envResult.success) {
		return c.json(
			{
				error: "Server MPP configuration is invalid.",
				missing: envResult.error.issues.map((issue) => issue.path.join(".")),
			},
			500,
		);
	}

	const query = c.req.query();

	const unitsInput = normalizeUnits(query.units ?? "paragraphs");
	if (!ALLOWED_UNITS_SET.has(unitsInput)) {
		return c.json(
			{ error: "Invalid units. Use words, sentences, or paragraphs." },
			400,
		);
	}

	const formatInput = query.format ?? "plain";
	if (!ALLOWED_FORMATS_SET.has(formatInput)) {
		return c.json({ error: "Invalid format. Use plain or html." }, 400);
	}

	const countInput = Number.parseInt(query.count ?? "1", 10);
	if (Number.isNaN(countInput) || countInput < 1 || countInput > MAX_COUNT) {
		return c.json(
			{ error: `Invalid count. Use an integer between 1 and ${MAX_COUNT}.` },
			400,
		);
	}

	const env = envResult.data;
	const payment = createPaymentHandler(env, new URL(c.req.url).host);
	const paymentResult = await payment.charge({
		amount: env.MPP_AMOUNT,
		currency: env.MPP_CURRENCY,
		decimals: env.MPP_DECIMALS,
		description: "Lorem ipsum API request",
		recipient: env.MPP_RECIPIENT,
	})(c.req.raw);

	if (paymentResult.status === 402) {
		return paymentResult.challenge;
	}

	const text = loremIpsum({
		count: countInput,
		units: unitsInput as AllowedUnit,
		format: formatInput as AllowedFormat,
	});

	return paymentResult.withReceipt(
		c.json({
			count: countInput,
			units: unitsInput,
			format: formatInput,
			text,
		}),
	);
});

export default app;
