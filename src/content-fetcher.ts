export interface FetchPageOptions {
	timeoutMs: number;
	maxBytes: number;
	headers?: Record<string, string>;
}

export interface FetchPageResult extends Record<string, unknown> {
	url: string;
	contentType: string;
	content: string;
	truncated: boolean;
}

export class ContentFetcherError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "ContentFetcherError";
	}
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(
				/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gim,
				" ",
			)
			.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gim, " ")
			.replace(
				/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gim,
				" ",
			)
			.replace(
				/<\/(p|div|section|article|main|header|footer|li|br|h[1-6])>/gi,
				"\n",
			)
			.replace(/<[^>]+>/g, " ")
			.replace(/\r/g, "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]{2,}/g, " ")
			.trim(),
	);
}

function truncateToBytes(
	input: string,
	maxBytes: number,
): { text: string; truncated: boolean } {
	const source = Buffer.from(input, "utf8");
	if (source.byteLength <= maxBytes) {
		return { text: input, truncated: false };
	}

	const ellipsis = "\n\n[truncated]";
	const suffixBytes = Buffer.byteLength(ellipsis, "utf8");
	const slice = source.subarray(0, Math.max(0, maxBytes - suffixBytes));

	return {
		text: slice.toString("utf8") + ellipsis,
		truncated: true,
	};
}

export async function fetchPageContent(
	url: string,
	options: FetchPageOptions,
	fetchImpl: typeof fetch = fetch,
): Promise<FetchPageResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

	try {
		const response = await fetchImpl(url, {
			method: "GET",
			redirect: "follow",
			headers: {
				Accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8",
				...options.headers,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new ContentFetcherError(
				`Fetching ${url} failed with status ${response.status}.`,
				response.status,
			);
		}

		const contentType =
			response.headers.get("content-type") ?? "application/octet-stream";
		const body = await response.text();
		const normalized = contentType.includes("html")
			? htmlToText(body)
			: body.trim();
		const truncated = truncateToBytes(normalized, options.maxBytes);

		return {
			url: response.url || url,
			contentType,
			content: truncated.text,
			truncated: truncated.truncated,
		};
	} catch (error) {
		if (error instanceof ContentFetcherError) {
			throw error;
		}

		if (error instanceof Error && error.name === "AbortError") {
			throw new ContentFetcherError(`Fetching ${url} timed out.`);
		}

		throw new ContentFetcherError(
			`Unexpected error while fetching ${url}: ${(error as Error).message}`,
		);
	} finally {
		clearTimeout(timeout);
	}
}
