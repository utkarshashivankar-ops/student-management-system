
const express = require("express");
const { randomUUID } = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const app = express();
app.use(express.json());

const API_URL = process.env.STUDENT_API_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;

if (!API_URL || !MCP_API_KEY) {
  throw new Error(
    "STUDENT_API_URL and MCP_API_KEY environment variables are required."
  );
}

function createMcpServer() {
  const server = new McpServer({
    name: "student-management-mcp",
    version: "1.0.0",
  });

  server.tool(
    "list_students",
    "Search and list students in the Student Management System. Read-only.",
    {
      search: z.string().optional().describe(
        "Optional keyword to search by student ID, name, email, or department"
      ),
    },
    async ({ search }) => {
      const url = new URL(`${API_URL}/api/students`);

      if (search) {
        url.searchParams.set("search", search.slice(0, 60));
      }

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`Student API returned HTTP ${response.status}`);
      }

      const result = await response.json();
      const students = result.data;

      if (result.success !== true || !Array.isArray(students)) {
        throw new Error("Unexpected response format from Student API");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.count,
                students: students.map((s) => ({
                  studentId: s.studentId,
                  name: s.name,
                  department: s.department,
                  email: s.email,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  if (req.get("authorization") !== `Bearer ${MCP_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    const server = createMcpServer();
    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).send("Use POST for MCP requests.");
});

app.delete("/mcp", (_req, res) => {
  res.status(405).send("Stateless MCP sessions are not supported here.");
});

app.get("/health", (_req, res) => {
  res.json({ success: true, service: "student-management-mcp" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Student MCP server listening on port ${PORT}`);
});
