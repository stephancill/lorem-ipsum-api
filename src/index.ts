import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
	bazaarResourceServerExtension,
	declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
	HonoAdapter,
	x402HTTPResourceServer,
	x402ResourceServer,
} from "@x402/hono";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { loremIpsum } from "lorem-ipsum";
import { Mppx, tempo } from "mppx/server";
import { isAddress } from "viem";

type Bindings = {
	ASSETS: Fetcher;
	DISCOVERY_OWNERSHIP_PROOF?: string;
	MPP_AMOUNT?: string;
	MPP_CURRENCY?: string;
	MPP_DECIMALS?: string;
	MPP_RECIPIENT?: string;
	MPP_SECRET_KEY?: string;
	X402_FACILITATOR_URL?: string;
	X402_NETWORK?: string;
	X402_PAY_TO?: string;
};

const app = new OpenAPIHono<{ Bindings: Bindings }>();

const MAX_COUNT = 50;
const ALLOWED_FORMATS = ["plain", "html"] as const;
const ALLOWED_UNITS = ["words", "sentences", "paragraphs"] as const;
const DEFAULT_X402_FACILITATOR_URL = "https://facilitator.payai.network";
const DEFAULT_X402_NETWORK = "eip155:8453";

type AllowedFormat = (typeof ALLOWED_FORMATS)[number];
type AllowedUnit = (typeof ALLOWED_UNITS)[number];

const DecimalAmountSchema = z
	.string()
	.regex(/^\d+(?:\.\d+)?$/, "Must be a non-negative decimal string.");

const EnvSchema = z
	.object({
		MPP_SECRET_KEY: z.string().min(1),
		MPP_RECIPIENT: z.string().refine((value) => isAddress(value), {
			message: "MPP_RECIPIENT must be a valid Ethereum address.",
		}),
		MPP_AMOUNT: DecimalAmountSchema,
		MPP_DECIMALS: z.coerce.number().int().nonnegative(),
		MPP_CURRENCY: z.string().min(1),
		X402_FACILITATOR_URL: z
			.string()
			.url()
			.default(DEFAULT_X402_FACILITATOR_URL),
		X402_NETWORK: z.string().min(1).default(DEFAULT_X402_NETWORK),
		X402_PAY_TO: z.string().optional(),
	})
	.superRefine((env, ctx) => {
		const fraction = env.MPP_AMOUNT.split(".")[1];
		if (fraction && fraction.length > env.MPP_DECIMALS) {
			ctx.addIssue({
				code: "custom",
				path: ["MPP_AMOUNT"],
				message: "MPP_AMOUNT has more fractional digits than MPP_DECIMALS.",
			});
		}
	});

type ParsedEnv = z.infer<typeof EnvSchema>;

const GenerateQuerySchema = z.object({
	count: z.coerce.number().int().min(1).max(MAX_COUNT).default(1),
	units: z
		.enum(["word", "words", "sentence", "sentences", "paragraph", "paragraphs"])
		.default("paragraphs")
		.transform((value) => normalizeUnits(value)),
	format: z.enum(ALLOWED_FORMATS).default("plain"),
});

const GenerateResponseSchema = z.object({
	count: z.number().int().min(1).max(MAX_COUNT),
	units: z.enum(ALLOWED_UNITS),
	format: z.enum(ALLOWED_FORMATS),
	text: z.string(),
});

const ErrorResponseSchema = z.object({
	error: z.string(),
});

const normalizeUnits = (value: string): AllowedUnit => {
	if (value === "word") return "words";
	if (value === "sentence") return "sentences";
	if (value === "paragraph") return "paragraphs";
	return value as AllowedUnit;
};

const toBaseUnitAmount = (amount: string, decimals: number): string => {
	const [whole, fraction = ""] = amount.split(".");
	const paddedFraction = fraction.padEnd(decimals, "0");
	const normalized = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "");
	return normalized === "" ? "0" : normalized;
};

const toX402UsdPrice = (amount: string): `$${string}` => {
	return `$${amount}`;
};

const createPaymentHandler = (env: ParsedEnv, realm: string) => {
	return Mppx.create({
		realm,
		secretKey: env.MPP_SECRET_KEY,
		methods: [tempo.charge()],
	});
};

const getX402PaywallConfig = (requestUrl: string, env: ParsedEnv) => {
	return {
		appName: "Lorem Ipsum API",
		currentUrl: requestUrl,
		testnet: env.X402_NETWORK.endsWith(":84532"),
	};
};

const buildLoremResponse = (query: z.infer<typeof GenerateQuerySchema>) => {
	const text = loremIpsum({
		count: query.count,
		units: query.units,
		format: query.format as AllowedFormat,
	});

	return {
		count: query.count,
		units: query.units,
		format: query.format,
		text,
	};
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
	const x402Price = toX402UsdPrice(env.MPP_AMOUNT);

	const cacheKey = `${env.X402_FACILITATOR_URL}|${env.X402_NETWORK}|${x402Price}|${payTo}`;
	if (!x402ServerCache || x402ServerCache.key !== cacheKey) {
		const facilitatorClient = new HTTPFacilitatorClient({
			url: env.X402_FACILITATOR_URL,
		});
		const network = env.X402_NETWORK as `${string}:${string}`;
		const resourceServer = new x402ResourceServer(facilitatorClient)
			.register("eip155:*", new ExactEvmScheme())
			.registerExtension(bazaarResourceServerExtension);

		const server = new x402HTTPResourceServer(resourceServer, {
			"GET /generate": {
				accepts: {
					scheme: "exact",
					price: x402Price,
					network,
					payTo,
				},
				description: "Lorem ipsum API request",
				mimeType: "application/json",
				extensions: {
					...declareDiscoveryExtension({
						input: {
							count: "2",
							units: "paragraphs",
							format: "plain",
						},
						inputSchema: {
							properties: {
								count: {
									type: "string",
									description: "Integer between 1 and 50",
								},
								units: {
									type: "string",
									enum: ["words", "sentences", "paragraphs"],
								},
								format: {
									type: "string",
									enum: ["plain", "html"],
								},
							},
						},
						output: {
							example: {
								count: 2,
								units: "paragraphs",
								format: "plain",
								text: "Lorem ipsum dolor sit amet.",
							},
						},
					}),
				},
			},
		});

		const paywall = createPaywall()
			.withNetwork(evmPaywall)
			.withConfig({
				appName: "Lorem Ipsum API",
				testnet: network === "eip155:84532",
			})
			.build();
		server.registerPaywallProvider(paywall);

		x402ServerCache = {
			key: cacheKey,
			server,
			initPromise: server.initialize(),
		};
	}

	await x402ServerCache.initPromise;
	return x402ServerCache.server;
};

const generateRoute = createRoute({
	method: "get",
	path: "/generate",
	operationId: "generateLoremIpsum",
	summary: "Generate lorem ipsum text",
	description:
		"Generate paid placeholder text as words, sentences, or paragraphs.",
	tags: ["Generation"],
	request: {
		query: GenerateQuerySchema,
	},
	responses: {
		200: {
			description: "Successful response",
			content: {
				"application/json": {
					schema: GenerateResponseSchema,
				},
			},
		},
		400: {
			description: "Invalid query parameters",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		402: {
			description: "Payment Required",
		},
		500: {
			description: "Server configuration invalid",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
						missing: z.array(z.string()).optional(),
						detail: z.string().optional(),
					}),
				},
			},
		},
	},
});

app.get("/", (c) => {
	return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url)));
});

app.get("/llms.txt", (c) => {
	return c.env.ASSETS.fetch(new Request(new URL("/llms.txt", c.req.url)));
});

app.get("/openapi.json", (c) => {
	const envResult = EnvSchema.safeParse(c.env);
	if (!envResult.success) {
		return c.json(
			{
				error: "Server configuration is invalid.",
				missing: envResult.error.issues.map((issue) => issue.path.join(".")),
			},
			500,
		);
	}

	const env = envResult.data;
	const amount = toBaseUnitAmount(env.MPP_AMOUNT, env.MPP_DECIMALS);

	const document = app.getOpenAPI31Document({
		openapi: "3.1.0",
		info: {
			title: "Lorem Ipsum API",
			version: "1.0.0",
			description: "Paid placeholder text API with MPP and x402 support.",
			"x-guidance":
				"Use GET /generate to create paid lorem ipsum text. Provide optional query params count (1-50), units (words|sentences|paragraphs), and format (plain|html). Handle 402 responses via either MPP (WWW-Authenticate/Payment-Receipt) or x402 (PAYMENT-REQUIRED/PAYMENT-SIGNATURE).",
		},
		servers: [{ url: new URL(c.req.url).origin }],
	});

	if (c.env.DISCOVERY_OWNERSHIP_PROOF) {
		document["x-discovery"] = {
			ownershipProofs: [c.env.DISCOVERY_OWNERSHIP_PROOF],
		};
	}

	document["x-service-info"] = {
		categories: ["text", "ai"],
		docs: {
			homepage: "https://lorem.steer.fun",
			apiReference: "https://lorem.steer.fun/llms.txt",
			llms: "/llms.txt",
		},
	};

	const generatePath = document.paths?.["/generate"]?.get as
		| Record<string, unknown>
		| undefined;
	if (generatePath) {
		generatePath["x-payment-info"] = {
			amount,
			currency: env.MPP_CURRENCY,
			description: "Generate lorem ipsum text",
			intent: "charge",
			method: "tempo",
		};
	}

	return c.json(document);
});

app.openapi(generateRoute, async (c) => {
	const envResult = EnvSchema.safeParse(c.env);
	if (!envResult.success) {
		return c.json(
			{
				error: "Server configuration is invalid.",
				missing: envResult.error.issues.map((issue) => issue.path.join(".")),
			},
			500,
		);
	}

	const query = c.req.valid("query");
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

	const x402Result = await httpServer.processHTTPRequest(
		requestContext,
		getX402PaywallConfig(c.req.url, env),
	);

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
			return c.json(buildLoremResponse(query), 200);
		}

		const response = c.json(buildLoremResponse(query), 200);
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

	return paymentResult.withReceipt(c.json(buildLoremResponse(query), 200));
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
