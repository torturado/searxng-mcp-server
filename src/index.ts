import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createSearxMcpServer } from "./server.js";

async function main(): Promise<void> {
	const config = loadConfig();
	const server = createSearxMcpServer(config);
	const transport = new StdioServerTransport();

	await server.connect(transport);
	console.error("SearXNG MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in stdio server:", error);
	process.exit(1);
});
