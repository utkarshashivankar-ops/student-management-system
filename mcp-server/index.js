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

// ---- helpers shared by all tools -------------------------------------------

// Calls the Student API. `id` is the MongoDB _id (used for update/delete routes).
async function callApi({ method = "GET", id, query, body } = {}) {
  const url = new URL(studentsUrl() + (id ? `/${encodeURIComponent(id)}` : ""));
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000), // Render free tier may need time to wake
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });

// Wraps a tool handler so network errors come back as a clean tool error.
const safe = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(`Could not reach the Student API: ${e.message}`);
  }
};

const rows = (data) => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);

// Finds one student by its studentId (e.g. "ST102"), exact match, case-insensitive.
async function findByStudentId(studentId) {
  const res = await callApi({ query: { search: studentId } });
  if (!res.ok) return { error: `Student API returned HTTP ${res.status}` };
  const match = rows(res.data).find(
    (s) => String(s.studentId).toLowerCase() === studentId.toLowerCase()
  );
  return { student: match || null };
}

// ---- MCP server -------------------------------------------------------------

function buildServer() {
  const server = new McpServer({ name: "student-management", version: "1.2.0" });

  server.registerTool(
    "list_students",
    {
      title: "List students",
      description: "List student records from the Student Management System (read-only). Optionally filter with a search term (ID, name, email or department).",
      inputSchema: { search: z.string().max(100).optional().describe("Optional search term") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safe(async ({ search }) => {
      const res = await callApi({ query: { search } });
      if (!res.ok) return fail(`Student API returned HTTP ${res.status}`);
      return ok(res.data);
    })
  );

  server.registerTool(
    "get_student",
    {
      title: "Get student",
      description: "Get one student's full record by studentId (for example ST102).",
      inputSchema: { studentId: z.string().min(1).max(50).describe("Student ID, e.g. ST102") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safe(async ({ studentId }) => {
      const { student, error } = await findByStudentId(studentId);
      if (error) return fail(error);
      if (!student) return fail(`No student found with studentId ${studentId}`);
      return ok(student);
    })
  );

  server.registerTool(
    "search_students",
    {
      title: "Search students",
      description: "Find students by department and/or semester, with an optional text search (ID, name, email). Read-only.",
      inputSchema: {
        search: z.string().max(100).optional().describe("Optional text search"),
        department: z.string().max(100).optional().describe("Department, e.g. computer"),
        semester: z.number().int().min(1).max(12).optional().describe("Semester number"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safe(async ({ search, department, semester }) => {
      const res = await callApi({ query: { search } });
      if (!res.ok) return fail(`Student API returned HTTP ${res.status}`);
      let list = rows(res.data);
      if (department) {
        list = list.filter((s) => String(s.department).toLowerCase() === department.toLowerCase());
      }
      if (semester !== undefined) list = list.filter((s) => Number(s.semester) === semester);
      return ok({ count: list.length, data: list });
    })
  );

  server.registerTool(
    "add_student",
    {
      title: "Add student",
      description: "Create a new student record. This writes to the live database.",
      inputSchema: {
        studentId: z.string().min(1).max(50).describe("Unique student ID, e.g. ST103"),
        name: z.string().min(1).max(100),
        email: z.string().email().max(150),
        department: z.string().min(1).max(100),
        semester: z.number().int().min(1).max(12),
        contact: z.string().min(5).max(20).describe("Phone number"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async (input) => {
      const { student, error } = await findByStudentId(input.studentId);
      if (error) return fail(error);
      if (student) return fail(`A student with studentId ${input.studentId} already exists.`);
      const res = await callApi({ method: "POST", body: input });
      if (!res.ok) return fail(`Student API returned HTTP ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    })
  );

  server.registerTool(
    "update_student",
    {
      title: "Update student",
      description: "Update fields of an existing student, found by studentId. Only the fields you pass are changed. This writes to the live database.",
      inputSchema: {
        studentId: z.string().min(1).max(50).describe("ID of the student to update, e.g. ST102"),
        name: z.string().min(1).max(100).optional(),
        email: z.string().email().max(150).optional(),
        department: z.string().min(1).max(100).optional(),
        semester: z.number().int().min(1).max(12).optional(),
        contact: z.string().min(5).max(20).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ studentId, ...changes }) => {
      if (Object.keys(changes).length === 0) return fail("Pass at least one field to update.");
      const { student, error } = await findByStudentId(studentId);
      if (error) return fail(error);
      if (!student) return fail(`No student found with studentId ${studentId}`);
      const res = await callApi({ method: "PUT", id: student._id, body: changes });
      if (!res.ok) return fail(`Student API returned HTTP ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    })
  );

  server.registerTool(
    "delete_student",
    {
      title: "Delete student",
      description: "Permanently delete a student by studentId. This cannot be undone. Requires confirm=true.",
      inputSchema: {
        studentId: z.string().min(1).max(50).describe("ID of the student to delete, e.g. ST102"),
        confirm: z.boolean().describe("Must be true to actually delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ studentId, confirm }) => {
      if (confirm !== true) return fail("Deletion not confirmed. Ask the user, then call again with confirm=true.");
      const { student, error } = await findByStudentId(studentId);
      if (error) return fail(error);
      if (!student) return fail(`No student found with studentId ${studentId}`);
      const res = await callApi({ method: "DELETE", id: student._id });
      if (!res.ok) return fail(`Student API returned HTTP ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ deleted: true, student });
    })
  );
  // FRONTEND FILE TOOLS - GitHub only, no backend/database changes

  const GITHUB_OWNER = "utkarshashivankar-ops";
  const GITHUB_REPO = "student-management-system";
  const FRONTEND_ROOT = "frontend/";

  async function githubRequest(path, options = {}) {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is missing.");
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/${path}`,
      {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.headers || {}),
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `GitHub API error ${response.status}: ${data.message || "Request failed"}`
      );
    }

    return data;
  }

  function validateFrontendPath(filePath) {
    if (
      typeof filePath !== "string" ||
      !filePath.startsWith(FRONTEND_ROOT) ||
      filePath.includes("..") ||
      filePath.includes("\\") ||
      filePath.startsWith("/") ||
      !/\.(html|css|js|jsx|ts|tsx|json|svg|md|txt)$/i.test(filePath)
    ) {
      throw new Error(
        "Only frontend text files are allowed. Use a path such as frontend/index.html."
      );
    }

    return filePath;
  }

  server.registerTool(
    "list_frontend_files",
    {
      title: "List frontend files",
      description:
        "List files in the student-management-system frontend folder. Does not modify files.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async () => {
      const data = await githubRequest(
        "git/trees/main?recursive=1"
      );

      const files = (data.tree || [])
        .filter(
          (item) =>
            item.type === "blob" &&
            item.path.startsWith(FRONTEND_ROOT) &&
            /\.(html|css|js|jsx|ts|tsx|json|svg|md|txt)$/i.test(item.path)
        )
        .map((item) => item.path);

      return ok({ count: files.length, files });
    })
  );

  server.registerTool(
    "get_frontend_file",
    {
      title: "Read frontend file",
      description:
        "Read a text file from the frontend folder of the GitHub repository. Does not modify files.",
      inputSchema: {
        path: z.string().min(1).max(300).describe(
          "Repository path, e.g. frontend/index.html"
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async ({ path }) => {
      validateFrontendPath(path);

      const file = await githubRequest(
        `contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`
      );

      if (file.encoding !== "base64" || !file.content) {
        return fail("File content is unavailable or not a supported text file.");
      }

      return ok({
        path: file.path,
        content: Buffer.from(file.content, "base64").toString("utf8"),
      });
    })
  );

  server.registerTool(
    "publish_frontend_file_to_main",
    {
      title: "Publish frontend file to GitHub",
      description:
        "Create or update a text file under frontend/ on the main branch. This can trigger a Netlify deployment. Only call after the user explicitly approves the exact file path and complete content. Requires confirm=true.",
      inputSchema: {
        path: z.string().min(1).max(300).describe(
          "Repository path, e.g. frontend/index.html"
        ),
        content: z.string().max(1000000).describe(
          "Complete new file content"
        ),
        commitMessage: z.string().min(5).max(150).describe(
          "Git commit message"
        ),
        confirm: z.boolean().describe(
          "Must be true only after the user approves this exact change"
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safe(async ({ path, content, commitMessage, confirm }) => {
      validateFrontendPath(path);

      if (confirm !== true) {
        return fail(
          "Not published. First show the user the exact path and full content, then get approval."
        );
      }

      let sha;

      try {
        const existing = await githubRequest(
          `contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`
        );
        sha = existing.sha;
      } catch (error) {
        if (!error.message.includes("GitHub API error 404")) {
          throw error;
        }
      }

      const result = await githubRequest(
        `contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: commitMessage,
            content: Buffer.from(content, "utf8").toString("base64"),
            branch: "main",
            ...(sha ? { sha } : {}),
          }),
        }
      );

      return ok({
        success: true,
        path: result.content?.path || path,
        commit: result.commit?.sha,
        message:
          "Frontend file committed to main. Netlify deployment may take a few minutes.",
      });
    })
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