import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const [urlArg] = Bun.argv.slice(2);

if (!urlArg) {
	console.error("Usage: bun run x402:request -- <url>");
	process.exit(1);
}

const targetUrl = (() => {
	try {
		return new URL(urlArg);
	} catch {
		console.error(`Invalid URL: ${urlArg}`);
		process.exit(1);
	}
})();

const privateKey = process.env.EVM_PRIVATE_KEY;
if (!privateKey) {
	console.error("Missing EVM_PRIVATE_KEY in environment.");
	console.error(
		"Run with: bun --env-file=.env.local run x402:request -- <url>",
	);
	process.exit(1);
}

if (!privateKey.startsWith("0x")) {
	console.error("EVM_PRIVATE_KEY must be 0x-prefixed hex.");
	process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const client = new x402Client().register(
	"eip155:*",
	new ExactEvmScheme(account),
);
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment(targetUrl.toString(), {
	method: "GET",
	headers: {
		accept: "application/json",
	},
});

const bodyText = await response.text();
let body: unknown = bodyText;
try {
	body = JSON.parse(bodyText);
} catch {
	// keep text body
}

console.log(`Status: ${response.status}`);
const paymentResponseHeader = response.headers.get("payment-response");
if (paymentResponseHeader) {
	console.log("payment-response header present");
}
console.log(body);
