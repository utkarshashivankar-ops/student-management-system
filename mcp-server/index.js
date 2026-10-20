// index.js - Student Management MCP server (Streamable HTTP, stateless)
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  oauthConfigured, protectedResourceMetadata, authServerMetadata,
  register, authorizeGet, authorizePost, token, requireAuth,
} from "./oauth.js";

const PORT = process.env.PORT || 3000;

// STUDENT_API_URL may be the site root, ".../api" or ".../api/students" - handle all three.
function studentsUrl() {
  const base = (process.env.STUDENT_API_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("STUDENT_API_URL is not set");
  if (/\/api\/students$/.test(base)) return base;
  if (/\/api$/.test(base)) return `${base}/students`;
  return `${base}/api/students`;
}

function buildServer() {
  const server = new McpServer({ name: "student-management", version: "1.1.0" });
  server.registerTool(
    "list_students",
    {
      title: "List students",
      description: "List student records from the Student Management System (read-only). Optionally filter with a search term (ID, name, email or department).",
      inputSchema: { search: z.string().max(100).optional().describe("Optional search term") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ search }) => {
      try {
        const url = new URL(studentsUrl());
        if (search) url.searchParams.set("search", search);
        const r = await fetch(url, { signal: AbortSignal.timeout(45000) }); // Render free tier may need time to wake
        if (!r.ok) return { isError: true, content: [{ type: "text", text: `Student API returned HTTP ${r.status}` }] };
        const data = await r.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Could not reach the Student API: ${e.message}` }] };
      }
    }
  );
  return server;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render sits behind a proxy
app.use((req, res, next) => { res.on("finish", () => console.log(req.method + " " + req.path + " " + res.statusCode)); next(); });

app.get("/health", (req, res) => res.json({ status: "ok", oauth: oauthConfigured() }));

// OAuth discovery + endpoints (needed for Claude web / Desktop connectors)
if (oauthConfigured()) {
  const form = express.urlencoded({ extended: false, limit: "20kb" });
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-authorization-server", authServerMetadata);
  app.post("/register", express.json({ limit: "20kb" }), register);
  app.get("/authorize", authorizeGet);
  app.post("/authorize", form, authorizePost);
  app.post("/token", form, token);
} else {
  console.warn("OAUTH_SECRET (32+ chars) and LOGIN_PASSWORD (12+ chars) not set: OAuth disabled, only MCP_API_KEY works.");
}

// The MCP endpoint (protected)
app.post("/mcp", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP error:", e.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
const notAllowed = (req, res) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", requireAuth, notAllowed);
app.delete("/mcp", requireAuth, notAllowed);

app.listen(PORT, () => console.log(`MCP server listening on ${PORT}`));
