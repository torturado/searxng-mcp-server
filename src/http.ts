import "dotenv/config";
import { randomUUID } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";

import { loadConfig } from "./config.js";
import { createSearxMcpServer } from "./server.js";

const config = loadConfig();
const app = createMcpExpressApp({
	host: config.http.bind,
	allowedHosts:
		config.http.allowedHosts.length > 0
			? config.http.allowedHosts
			: undefined,
});

app.use(express.json({ limit: "1mb" }));

type SessionEntry = {
	server: ReturnType<typeof createSearxMcpServer>;
	transport: StreamableHTTPServerTransport;
	close: () => Promise<void>;
};

const sessions = new Map<string, SessionEntry>();

function removeSessionEntry(target: SessionEntry): void {
	for (const [sessionId, entry] of sessions) {
		if (entry === target) {
			sessions.delete(sessionId);
			return;
		}
	}
}

function getHeaderValue(
	value: string | string[] | undefined,
): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function normalizeHost(hostHeader: string): string {
	if (hostHeader.startsWith("[")) {
		const endBracket = hostHeader.indexOf("]");
		return endBracket >= 0
			? hostHeader.slice(0, endBracket + 1)
			: hostHeader;
	}

	return hostHeader.split(":")[0];
}

function sendJsonError(res: Response, status: number, message: string): void {
	if (res.headersSent) {
		return;
	}

	res.status(status).json({
		jsonrpc: "2.0",
		error: {
			code: -32000,
			message,
		},
		id: null,
	});
}

function validateOrigin(req: Request, res: Response, next: NextFunction): void {
	if (config.http.allowedOrigins.length === 0) {
		next();
		return;
	}

	const origin = getHeaderValue(req.headers.origin);
	if (!origin || config.http.allowedOrigins.includes(origin)) {
		next();
		return;
	}

	res.status(403).json({ error: "Origin not allowed" });
}

function validateHost(req: Request, res: Response, next: NextFunction): void {
	if (config.http.allowedHosts.length === 0) {
		next();
		return;
	}

	const host = getHeaderValue(req.headers.host);
	if (!host) {
		res.status(400).json({ error: "Missing Host header" });
		return;
	}

	if (config.http.allowedHosts.includes(normalizeHost(host))) {
		next();
		return;
	}

	res.status(403).json({ error: "Host not allowed" });
}

function requireBearerToken(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (!config.http.authToken) {
		next();
		return;
	}

	const authorization = getHeaderValue(req.headers.authorization);
	const expected = `Bearer ${config.http.authToken}`;

	if (authorization === expected) {
		next();
		return;
	}

	res.setHeader("WWW-Authenticate", 'Bearer realm="searxng-mcp"');
	res.status(401).json({ error: "Unauthorized" });
}

function extractSessionId(req: Request): string | undefined {
	return getHeaderValue(req.headers["mcp-session-id"]);
}

function createSessionEntry(): SessionEntry {
	const server = createSearxMcpServer(config);
	let entry: SessionEntry;
	let closePromise: Promise<void> | undefined;

	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
		onsessioninitialized: (sessionId) => {
			sessions.set(sessionId, entry);
		},
	});

	const close = async (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}

		closePromise = (async () => {
			removeSessionEntry(entry);
			try {
				await server.close();
			} catch (error) {
				console.error("Error while closing session server:", error);
			}
		})();

		return closePromise;
	};

	entry = { server, transport, close };

	transport.onclose = () => {
		void close();
	};

	transport.onerror = (error) => {
		console.error("HTTP transport error:", error);
	};

	return entry;
}

app.use(validateOrigin);
app.use(validateHost);
app.use(requireBearerToken);

app.get("/health", (_req, res) => {
	res.json({
		ok: true,
		sessions: sessions.size,
		bind: config.http.bind,
	});
});

app.post("/mcp", async (req, res) => {
	try {
		const sessionId = extractSessionId(req);

		if (sessionId) {
			const session = sessions.get(sessionId);
			if (!session) {
				sendJsonError(res, 404, "Session not found.");
				return;
			}

			await session.transport.handleRequest(req, res, req.body);
			return;
		}

		if (!isInitializeRequest(req.body)) {
			sendJsonError(
				res,
				400,
				"Initialization required before opening a new session.",
			);
			return;
		}

		const session = createSessionEntry();
		await session.server.connect(session.transport);
		await session.transport.handleRequest(req, res, req.body);
	} catch (error) {
		console.error("Error handling POST /mcp:", error);
		sendJsonError(res, 500, "Internal server error.");
	}
});

app.get("/mcp", async (req, res) => {
	try {
		const sessionId = extractSessionId(req);
		if (!sessionId) {
			sendJsonError(res, 400, "Missing mcp-session-id header.");
			return;
		}

		const session = sessions.get(sessionId);
		if (!session) {
			sendJsonError(res, 404, "Session not found.");
			return;
		}

		await session.transport.handleRequest(req, res);
	} catch (error) {
		console.error("Error handling GET /mcp:", error);
		sendJsonError(res, 500, "Internal server error.");
	}
});

app.delete("/mcp", async (req, res) => {
	try {
		const sessionId = extractSessionId(req);
		if (!sessionId) {
			sendJsonError(res, 400, "Missing mcp-session-id header.");
			return;
		}

		const session = sessions.get(sessionId);
		if (!session) {
			sendJsonError(res, 404, "Session not found.");
			return;
		}

		await session.transport.handleRequest(req, res);
	} catch (error) {
		console.error("Error handling DELETE /mcp:", error);
		sendJsonError(res, 500, "Internal server error.");
	}
});

const httpServer = app.listen(config.http.port, config.http.bind, () => {
	console.log(
		`SearXNG MCP Server listening on http://${config.http.bind}:${config.http.port}/mcp`,
	);
});

async function shutdown(signal: string): Promise<void> {
	console.log(`Received ${signal}, shutting down...`);

	const activeSessions = [...sessions.values()];
	sessions.clear();

	for (const session of activeSessions) {
		try {
			await session.close();
		} catch (error) {
			console.error("Error closing server:", error);
		}
	}

	await new Promise<void>((resolve, reject) => {
		httpServer.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		shutdown(signal)
			.then(() => process.exit(0))
			.catch((error) => {
				console.error("Shutdown failed:", error);
				process.exit(1);
			});
	});
}
