import { z } from "zod";

const DEFAULT_SEARXNG_TIMEOUT_MS = 15_000;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_FETCH_MAX_BYTES = 500_000;
const DEFAULT_HTTP_PORT = 3100;

const localBinds = new Set(["127.0.0.1", "localhost", "::1"]);

const jsonRecordSchema = z.record(z.string(), z.string());
const jsonArraySchema = z.array(z.string());
const optionalNonEmptyString = z.preprocess(
	(value) => (value === "" ? undefined : value),
	z.string().min(1).optional(),
);

export interface AppConfig {
	searxng: {
		baseUrl: string;
		headers: Record<string, string>;
		timeoutMs: number;
	};
	fetch: {
		timeoutMs: number;
		maxBytes: number;
	};
	http: {
		port: number;
		bind: string;
		allowedOrigins: string[];
		allowedHosts: string[];
		authToken?: string;
		isLocalOnly: boolean;
	};
}

function parseJsonEnv<T>(
	value: string | undefined,
	fallback: T,
	schema: z.ZodType<T>,
	fieldName: string,
): T {
	if (!value) {
		return fallback;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(
			`Invalid JSON in ${fieldName}: ${(error as Error).message}`,
		);
	}

	return schema.parse(parsed);
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function defaultBind(env: NodeJS.ProcessEnv): string {
	return env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const baseSchema = z.object({
		SEARXNG_BASE_URL: z.string().url(),
		SEARXNG_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_SEARXNG_TIMEOUT_MS),
		FETCH_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_FETCH_TIMEOUT_MS),
		FETCH_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_FETCH_MAX_BYTES),
		HTTP_PORT: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_HTTP_PORT),
		HTTP_BIND: z.string().min(1).default(defaultBind(env)),
		HTTP_AUTH_TOKEN: optionalNonEmptyString,
	});

	const parsed = baseSchema.parse({
		SEARXNG_BASE_URL: env.SEARXNG_BASE_URL,
		SEARXNG_TIMEOUT_MS: env.SEARXNG_TIMEOUT_MS,
		FETCH_TIMEOUT_MS: env.FETCH_TIMEOUT_MS,
		FETCH_MAX_BYTES: env.FETCH_MAX_BYTES,
		HTTP_PORT: env.HTTP_PORT,
		HTTP_BIND: env.HTTP_BIND,
		HTTP_AUTH_TOKEN: env.HTTP_AUTH_TOKEN,
	});

	const headers = parseJsonEnv(
		env.SEARXNG_HEADERS,
		{},
		jsonRecordSchema,
		"SEARXNG_HEADERS",
	);
	const allowedOrigins = parseJsonEnv(
		env.HTTP_ALLOWED_ORIGINS,
		[],
		jsonArraySchema,
		"HTTP_ALLOWED_ORIGINS",
	);
	const allowedHosts = parseJsonEnv(
		env.HTTP_ALLOWED_HOSTS,
		[],
		jsonArraySchema,
		"HTTP_ALLOWED_HOSTS",
	);

	const bind = parsed.HTTP_BIND;
	const isLocalOnly = localBinds.has(bind);

	if (!isLocalOnly && !parsed.HTTP_AUTH_TOKEN) {
		throw new Error(
			"HTTP_AUTH_TOKEN is required when HTTP_BIND exposes the server beyond localhost.",
		);
	}

	return {
		searxng: {
			baseUrl: normalizeBaseUrl(parsed.SEARXNG_BASE_URL),
			headers,
			timeoutMs: parsed.SEARXNG_TIMEOUT_MS,
		},
		fetch: {
			timeoutMs: parsed.FETCH_TIMEOUT_MS,
			maxBytes: parsed.FETCH_MAX_BYTES,
		},
		http: {
			port: parsed.HTTP_PORT,
			bind,
			allowedOrigins,
			allowedHosts,
			authToken: parsed.HTTP_AUTH_TOKEN,
			isLocalOnly,
		},
	};
}
