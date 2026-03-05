import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { ContentFetcherError, fetchPageContent } from "./content-fetcher.js";
import { SearxClient, SearxClientError } from "./searx-client.js";

function formatSearchResults(
	query: string,
	response: Awaited<ReturnType<SearxClient["search"]>>,
): string {
	const lines: string[] = [`Search results for "${query}":`];

	if (response.answer) {
		lines.push("", `Direct answer: ${response.answer}`);
	}

	if (response.suggestions.length > 0) {
		lines.push("", `Suggestions: ${response.suggestions.join(", ")}`);
	}

	if (response.results.length === 0) {
		lines.push("", "No results returned by SearXNG.");
		return lines.join("\n");
	}

	response.results.forEach((result, index) => {
		lines.push(
			"",
			`${index + 1}. ${result.title}`,
			`URL: ${result.url}`,
			`Engine: ${result.engine}`,
			result.content ? `Snippet: ${result.content}` : "Snippet: (empty)",
		);
	});

	return lines.join("\n");
}

export function createSearxMcpServer(config: AppConfig): McpServer {
	const server = new McpServer(
		{
			name: "searxng-mcp-server",
			version: "0.1.0",
		},
		{
			capabilities: {
				logging: {},
			},
		},
	);

	const searxClient = new SearxClient(config.searxng);

	server.registerTool(
		"search",
		{
			title: "Web Search",
			description: "Search the web through a SearXNG instance.",
			inputSchema: {
				query: z.string().min(1).describe("Search query."),
				pageno: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Page number."),
				language: z
					.string()
					.optional()
					.describe("Language code, for example en or es."),
				categories: z
					.string()
					.optional()
					.describe(
						"Comma-separated categories such as general,news,it.",
					),
				safesearch: z
					.number()
					.int()
					.min(0)
					.max(2)
					.optional()
					.describe("0, 1 or 2."),
				timeRange: z
					.enum(["day", "month", "year"])
					.optional()
					.describe("Optional time filter for supporting engines."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.default(5)
					.describe("Maximum number of results to return."),
			},
			outputSchema: z.object({
				query: z.string(),
				answer: z.string().optional(),
				suggestions: z.array(z.string()),
				results: z.array(
					z.object({
						title: z.string(),
						url: z.string().url(),
						content: z.string(),
						engine: z.string(),
						score: z.number().optional(),
					}),
				),
			}),
		},
		async (args) => {
			try {
				const response = await searxClient.search({
					query: args.query,
					pageno: args.pageno,
					language: args.language,
					categories: args.categories,
					safesearch: args.safesearch,
					timeRange: args.timeRange,
					limit: args.limit,
				});

				return {
					content: [
						{
							type: "text",
							text: formatSearchResults(args.query, response),
						},
					],
					structuredContent: response,
				};
			} catch (error) {
				const message =
					error instanceof SearxClientError
						? error.message
						: `Search failed: ${(error as Error).message}`;

				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"fetch",
		{
			title: "Fetch URL",
			description: "Fetch a web page and extract readable text content.",
			inputSchema: {
				url: z.string().url().describe("Absolute URL to fetch."),
			},
			outputSchema: z.object({
				url: z.string().url(),
				contentType: z.string(),
				content: z.string(),
				truncated: z.boolean(),
			}),
		},
		async ({ url }) => {
			try {
				const result = await fetchPageContent(url, {
					timeoutMs: config.fetch.timeoutMs,
					maxBytes: config.fetch.maxBytes,
					headers: config.searxng.headers,
				});

				return {
					content: [
						{
							type: "text",
							text: result.content,
						},
					],
					structuredContent: result,
				};
			} catch (error) {
				const message =
					error instanceof ContentFetcherError
						? error.message
						: `Fetching failed: ${(error as Error).message}`;

				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}
		},
	);

	return server;
}
