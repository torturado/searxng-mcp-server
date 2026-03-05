import type { AppConfig } from "./config.js";

export interface SearchParams {
	query: string;
	pageno?: number;
	language?: string;
	categories?: string;
	safesearch?: number;
	timeRange?: "day" | "month" | "year";
	limit?: number;
}

export interface NormalizedSearchResult extends Record<string, unknown> {
	title: string;
	url: string;
	content: string;
	engine: string;
	score?: number;
}

export interface NormalizedSearchResponse extends Record<string, unknown> {
	query: string;
	answer?: string;
	suggestions: string[];
	results: NormalizedSearchResult[];
}

interface SearxRawResult {
	title?: string;
	url?: string;
	content?: string;
	engine?: string;
	engines?: string[];
	score?: number;
}

interface SearxRawResponse {
	query?: string;
	answer?: string;
	answers?: string[];
	suggestions?: string[];
	corrections?: string[];
	results?: SearxRawResult[];
}

export class SearxClientError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "SearxClientError";
	}
}

export class SearxClient {
	constructor(
		private readonly config: AppConfig["searxng"],
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async search(params: SearchParams): Promise<NormalizedSearchResponse> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			this.config.timeoutMs,
		);

		try {
			const url = new URL("/search", this.config.baseUrl);
			url.searchParams.set("q", params.query);
			url.searchParams.set("format", "json");

			if (params.pageno) {
				url.searchParams.set("pageno", String(params.pageno));
			}
			if (params.language) {
				url.searchParams.set("language", params.language);
			}
			if (params.categories) {
				url.searchParams.set("categories", params.categories);
			}
			if (params.safesearch !== undefined) {
				url.searchParams.set("safesearch", String(params.safesearch));
			}
			if (params.timeRange) {
				url.searchParams.set("time_range", params.timeRange);
			}

			const response = await this.fetchImpl(url, {
				method: "GET",
				headers: {
					Accept: "application/json",
					...this.config.headers,
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				const body = await response.text().catch(() => "");
				throw new SearxClientError(
					`SearXNG request failed with status ${response.status}.`,
					response.status,
					body,
				);
			}

			const payload = (await response.json()) as SearxRawResponse;
			const results = (payload.results ?? [])
				.filter((item): item is SearxRawResult & { url: string } =>
					Boolean(item.url),
				)
				.slice(0, params.limit ?? 5)
				.map((item) => ({
					title: item.title?.trim() || item.url,
					url: item.url,
					content: item.content?.trim() || "",
					engine: item.engine ?? item.engines?.[0] ?? "unknown",
					score: item.score,
				}));

			return {
				query: payload.query ?? params.query,
				answer: payload.answer ?? payload.answers?.find(Boolean),
				suggestions: [
					...(payload.suggestions ?? []),
					...(payload.corrections ?? []),
				],
				results,
			};
		} catch (error) {
			if (error instanceof SearxClientError) {
				throw error;
			}

			if (error instanceof Error && error.name === "AbortError") {
				throw new SearxClientError("SearXNG request timed out.");
			}

			throw new SearxClientError(
				`Unexpected error while querying SearXNG: ${(error as Error).message}`,
			);
		} finally {
			clearTimeout(timeout);
		}
	}
}
