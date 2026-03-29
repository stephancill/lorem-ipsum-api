import { Hono, type Context } from "hono";
import { loremIpsum } from "lorem-ipsum";
import { Mppx, tempo } from "mppx/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
	HonoAdapter,
	x402HTTPResourceServer,
	x402ResourceServer,
} from "@x402/hono";
import { isAddress } from "viem";
import { z } from "zod";

type Bindings = {
	ASSETS: Fetcher;
	MPP_AMOUNT?: string;
	MPP_CURRENCY?: string;
	MPP_DECIMALS?: string;
	MPP_RECIPIENT?: string;
	MPP_SECRET_KEY?: string;
};

type AppContext = Context<{ Bindings: Bindings }>;

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
const DEFAULT_X402_FACILITATOR_URL = "https://facilitator.payai.network";
const DEFAULT_X402_NETWORK = "eip155:8453";
const DEFAULT_X402_PRICE = "$0.001";

const EnvSchema = z.object({
	MPP_SECRET_KEY: z.string().min(1),
	MPP_RECIPIENT: z.string().refine((value) => isAddress(value), {
		message: "MPP_RECIPIENT must be a valid Ethereum address.",
	}),
	MPP_AMOUNT: z.string().min(1).default(DEFAULT_PRICE_AMOUNT),
	MPP_DECIMALS: z.coerce
		.number()
		.int()
		.nonnegative()
		.default(DEFAULT_PRICE_DECIMALS),
	MPP_CURRENCY: z.string().min(1).default(DEFAULT_PATH_USD),
	X402_FACILITATOR_URL: z.string().url().default(DEFAULT_X402_FACILITATOR_URL),
	X402_NETWORK: z.string().min(1).default(DEFAULT_X402_NETWORK),
	X402_PRICE: z.string().min(1).default(DEFAULT_X402_PRICE),
	X402_PAY_TO: z.string().optional(),
});

type ParsedEnv = z.infer<typeof EnvSchema>;

const createPaymentHandler = (
	env: z.infer<typeof EnvSchema>,
	realm: string,
) => {
	return Mppx.create({
		realm,
		secretKey: env.MPP_SECRET_KEY,
		methods: [tempo.charge()],
	});
};

const normalizeUnits = (value: string): AllowedUnit | string => {
	if (value === "word") return "words";
	if (value === "sentence") return "sentences";
	if (value === "paragraph") return "paragraphs";
	return value;
};

const getLoremInput = (c: AppContext) => {
	const query = c.req.query();

	const unitsInput = normalizeUnits(query.units ?? "paragraphs");
	if (!ALLOWED_UNITS_SET.has(unitsInput)) {
		return {
			error: c.json(
				{ error: "Invalid units. Use words, sentences, or paragraphs." },
				400,
			),
		};
	}

	const formatInput = query.format ?? "plain";
	if (!ALLOWED_FORMATS_SET.has(formatInput)) {
		return {
			error: c.json({ error: "Invalid format. Use plain or html." }, 400),
		};
	}

	const countInput = Number.parseInt(query.count ?? "1", 10);
	if (Number.isNaN(countInput) || countInput < 1 || countInput > MAX_COUNT) {
		return {
			error: c.json(
				{ error: `Invalid count. Use an integer between 1 and ${MAX_COUNT}.` },
				400,
			),
		};
	}

	return {
		countInput,
		unitsInput,
		formatInput,
	};
};

const buildLoremResponse = (
	c: AppContext,
	input: { countInput: number; unitsInput: string; formatInput: string },
) => {
	const text = loremIpsum({
		count: input.countInput,
		units: input.unitsInput as AllowedUnit,
		format: input.formatInput as AllowedFormat,
	});

	return c.json({
		count: input.countInput,
		units: input.unitsInput,
		format: input.formatInput,
		text,
	});
};

let x402ServerCache:
	| {
			key: string;
			server: x402HTTPResourceServer;
			initPromise: Promise<void>;
	  }
	| undefined;

const getX402Server = async (env: ParsedEnv) => {
	const payTo = env.X402_PAY_TO ?? env.MPP_RECIPIENT;
	if (!isAddress(payTo)) {
		throw new Error("X402 pay-to address must be a valid Ethereum address.");
	}

	const cacheKey = `${env.X402_FACILITATOR_URL}|${env.X402_NETWORK}|${env.X402_PRICE}|${payTo}`;
	if (!x402ServerCache || x402ServerCache.key !== cacheKey) {
		const facilitatorClient = new HTTPFacilitatorClient({
			url: env.X402_FACILITATOR_URL,
		});
		const network = env.X402_NETWORK as `${string}:${string}`;
		const resourceServer = new x402ResourceServer(facilitatorClient).register(
			"eip155:*",
			new ExactEvmScheme(),
		);
		const server = new x402HTTPResourceServer(resourceServer, {
			"GET /lorem": {
				accepts: {
					scheme: "exact",
					price: env.X402_PRICE,
					network,
					payTo,
				},
				description: "Lorem ipsum API request",
				mimeType: "application/json",
			},
		});

		x402ServerCache = {
			key: cacheKey,
			server,
			initPromise: server.initialize(),
		};
	}

	await x402ServerCache.initPromise;
	return x402ServerCache.server;
};

app.get("/", (c) => {
	return c.env.ASSETS.fetch(new Request(new URL("/llms.txt", c.req.url)));
});

app.get("/llms.txt", (c) => {
	return c.env.ASSETS.fetch(new Request(new URL("/llms.txt", c.req.url)));
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

	const loremInput = getLoremInput(c);
	if ("error" in loremInput) {
		return loremInput.error;
	}

	const env = envResult.data;
	const hasX402Proof = Boolean(
		c.req.header("payment-signature") ?? c.req.header("x-payment"),
	);

	let httpServer: x402HTTPResourceServer;
	try {
		httpServer = await getX402Server(env);
	} catch (error) {
		return c.json(
			{
				error: "Server x402 configuration is invalid.",
				detail:
					error instanceof Error
						? error.message
						: "Unable to initialize x402 server.",
			},
			500,
		);
	}

	const adapter = new HonoAdapter(c);
	const requestContext = {
		adapter,
		path: c.req.path,
		method: c.req.method,
		paymentHeader:
			adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment"),
	};

	const x402Result = await httpServer.processHTTPRequest(requestContext);
	if (hasX402Proof) {
		if (x402Result.type === "payment-error") {
			const body = x402Result.response.isHtml
				? String(x402Result.response.body ?? "")
				: JSON.stringify(x402Result.response.body ?? {});
			return new Response(body, {
				status: x402Result.response.status,
				headers: x402Result.response.headers,
			});
		}

		if (x402Result.type === "no-payment-required") {
			return buildLoremResponse(c, loremInput);
		}

		const response = buildLoremResponse(c, loremInput);
		const settleResult = await httpServer.processSettlement(
			x402Result.paymentPayload,
			x402Result.paymentRequirements,
			x402Result.declaredExtensions,
		);

		if (!settleResult.success) {
			const body = settleResult.response.isHtml
				? String(settleResult.response.body ?? "")
				: JSON.stringify(settleResult.response.body ?? {});
			return new Response(body, {
				status: settleResult.response.status,
				headers: settleResult.response.headers,
			});
		}

		for (const [key, value] of Object.entries(settleResult.headers)) {
			response.headers.set(key, value);
		}

		return response;
	}

	const payment = createPaymentHandler(env, new URL(c.req.url).host);
	const paymentResult = await payment.charge({
		amount: env.MPP_AMOUNT,
		currency: env.MPP_CURRENCY,
		decimals: env.MPP_DECIMALS,
		description: "Lorem ipsum API request",
		recipient: env.MPP_RECIPIENT,
	})(c.req.raw);

	if (paymentResult.status === 402) {
		if (x402Result.type === "payment-error") {
			const mppHeaders = new Headers(paymentResult.challenge.headers);
			for (const [key, value] of Object.entries(x402Result.response.headers)) {
				mppHeaders.set(key, value);
			}
			const body = x402Result.response.isHtml
				? String(x402Result.response.body ?? "")
				: JSON.stringify(x402Result.response.body ?? {});
			return new Response(body, {
				status: 402,
				headers: mppHeaders,
			});
		}

		return paymentResult.challenge;
	}

	return paymentResult.withReceipt(buildLoremResponse(c, loremInput));
});

app.get("*", async (c) => {
	const staticResponse = await c.env.ASSETS.fetch(
		new Request(new URL(c.req.path, c.req.url)),
	);
	if (staticResponse.status !== 404) {
		return staticResponse;
	}

	return c.notFound();
});

export default app;
