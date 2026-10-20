// oauth.js - minimal single-owner OAuth 2.1 authorization server + token check.
// Uses only Node built-ins. Stateless: clients, codes and tokens are HMAC-signed.
import crypto from "node:crypto";

const PUBLIC_URL = (process.env.PUBLIC_URL || "https://student-management-mcp.onrender.com").replace(/\/+$/, "");
export const RESOURCE = `${PUBLIC_URL}/mcp`;
const SECRET = process.env.OAUTH_SECRET || "";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "";
const SCOPE = "student:read";

const CODE_TTL = 60;               // seconds
const ACCESS_TTL = 60 * 60;        // 1 hour
const REFRESH_TTL = 30 * 24 * 3600; // 30 days

export function oauthConfigured() {
  return SECRET.length >= 32 && LOGIN_PASSWORD.length >= 12;
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token, typ) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const good = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (!safeEq(mac, good)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (p.typ !== typ) return null;
  if (p.exp && p.exp < now()) return null;
  return p;
}
export function safeEq(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- redirect URI allow-list ----------
function redirectAllowed(uri) {
   if (uri === "https://claude.ai/api/mcp/auth_callback" || uri === "https://claude.com/api/mcp/auth_callback") return true;
  try {
    const u = new URL(uri); // Claude Code uses a loopback redirect on a random port
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback";
  } catch { return false; }
}

// ---------- metadata ----------
export function protectedResourceMetadata(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    resource: RESOURCE,
    authorization_servers: [PUBLIC_URL],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}
export function authServerMetadata(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/authorize`,
    token_endpoint: `${PUBLIC_URL}/token`,
    registration_endpoint: `${PUBLIC_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

// ---------- dynamic client registration (RFC 7591) ----------
export function register(req, res) {
  const b = req.body || {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string" && redirectAllowed(u))) {
    return res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uri not allowed" });
  }
  const name = typeof b.client_name === "string" ? b.client_name.slice(0, 100) : "MCP client";
  const iat = now();
  const client_id = sign({ typ: "client", uris, name, iat });
  res.status(201).json({
    client_id,
    client_id_issued_at: iat,
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

// ---------- authorize ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function checkAuthRequest(q) {
  const client = verify(q.client_id, "client");
  if (!client) return { error: "Unknown client." };
  if (!client.uris.includes(q.redirect_uri)) return { error: "redirect_uri does not match the registered client." };
  const fail = (code, desc) => ({ redirect: true, client, code, desc });
  if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with S256 is required.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) return fail("invalid_request", "Bad code_challenge.");
  if (q.resource && q.resource.replace(/\/+$/, "") !== RESOURCE) return fail("invalid_target", "Unknown resource.");
  return { ok: true, client };
}
function redirectWith(res, uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  res.redirect(302, u.toString());
}
function securityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai  https://claude.com http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
}
function loginPage(q, message) {
  const hidden = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
    .filter((k) => q[k] !== undefined)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title><style>body{font-family:system-ui,sans-serif;max-width:380px;margin:12vh auto;padding:0 16px;color:#222}
input[type=password]{width:100%;padding:10px;margin:8px 0 12px;box-sizing:border-box}button{padding:10px 16px;cursor:pointer}.err{color:#b00020}</style></head>
<body><h2>Student Management MCP</h2>
<p>An app (${esc(q._clientName || "Claude")}) wants read-only access to the student list. Enter the owner password to allow it.</p>
${message ? `<p class="err">${esc(message)}</p>` : ""}
<form method="post" action="/authorize">${hidden}
<label>Owner password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button type="submit">Allow access</button></form></body></html>`;
}

export function authorizeGet(req, res) {
  securityHeaders(res);
  const q = req.query || {};
  const c = checkAuthRequest(q);
  if (c.error) return res.status(400).type("text").send(c.error);
  if (c.redirect) return redirectWith(res, q.redirect_uri, { error: c.code, error_description: c.desc, state: q.state });
  q._clientName = c.client.name;
  res.type("html").send(loginPage(q));
}

const attempts = new Map(); // ip -> {n, reset}
function tooMany(ip) {
  const t = Date.now(), e = attempts.get(ip);
  if (!e || e.reset < t) return false;
  return e.n >= 5;
}
function noteFail(ip) {
  const t = Date.now(), e = attempts.get(ip);
  if (!e || e.reset < t) attempts.set(ip, { n: 1, reset: t + 15 * 60 * 1000 });
  else e.n++;
}
const usedCodes = new Map(); // jti -> exp (single-use within code lifetime)
function markUsed(jti, exp) {
  const t = now();
  for (const [k, v] of usedCodes) if (v < t) usedCodes.delete(k);
  if (usedCodes.has(jti)) return false;
  usedCodes.set(jti, exp);
  return true;
}

export function authorizePost(req, res) {
  securityHeaders(res);
  const q = req.body || {};
  const c = checkAuthRequest(q);
  if (c.error) return res.status(400).type("text").send(c.error);
  if (c.redirect) return redirectWith(res, q.redirect_uri, { error: c.code, error_description: c.desc, state: q.state });
  q._clientName = c.client.name;
  const ip = req.ip || "unknown";
  if (tooMany(ip)) return res.status(429).type("html").send(loginPage(q, "Too many attempts. Try again in 15 minutes."));
  if (typeof q.password !== "string" || !safeEq(q.password, LOGIN_PASSWORD)) {
    noteFail(ip);
    return res.status(401).type("html").send(loginPage(q, "Wrong password."));
  }
  const exp = now() + CODE_TTL;
  const code = sign({ typ: "code", cid: q.client_id, ruri: q.redirect_uri, cc: q.code_challenge, exp, jti: crypto.randomUUID() });
  redirectWith(res, q.redirect_uri, { code, state: q.state });
}

// ---------- token ----------
function tokenError(res, status, error, desc) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.status(status).json({ error, error_description: desc });
}
function issue(cid) {
  const t = now();
  return {
    access_token: sign({ typ: "access", cid, aud: RESOURCE, scope: SCOPE, exp: t + ACCESS_TTL }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: sign({ typ: "refresh", cid, scope: SCOPE, exp: t + REFRESH_TTL, jti: crypto.randomUUID() }),
    scope: SCOPE,
  };
}
export function token(req, res) {
  const b = req.body || {};
  const client = verify(b.client_id, "client");
  if (!client) return tokenError(res, 401, "invalid_client", "Unknown client_id.");
  if (b.resource && b.resource.replace(/\/+$/, "") !== RESOURCE) return tokenError(res, 400, "invalid_target", "Unknown resource.");

  if (b.grant_type === "authorization_code") {
    const code = verify(b.code, "code");
    if (!code || code.cid !== b.client_id || code.ruri !== b.redirect_uri) return tokenError(res, 400, "invalid_grant", "Invalid or expired code.");
    if (typeof b.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier)) return tokenError(res, 400, "invalid_grant", "Bad code_verifier.");
    const challenge = crypto.createHash("sha256").update(b.code_verifier).digest("base64url");
    if (!safeEq(challenge, code.cc)) return tokenError(res, 400, "invalid_grant", "PKCE verification failed.");
    if (!markUsed(code.jti, code.exp)) return tokenError(res, 400, "invalid_grant", "Code already used.");
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache");
    return res.json(issue(b.client_id));
  }
  if (b.grant_type === "refresh_token") {
    const r = verify(b.refresh_token, "refresh");
    if (!r || r.cid !== b.client_id) return tokenError(res, 400, "invalid_grant", "Invalid or expired refresh token.");
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache");
    return res.json(issue(b.client_id));
  }
  return tokenError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

// ---------- protect /mcp ----------
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const tok = m ? m[1].trim() : "";
  const staticKey = process.env.MCP_API_KEY || "";
  if (tok) {
    if (staticKey && safeEq(tok, staticKey)) return next();          // Desktop via mcp-remote
    if (oauthConfigured()) {
      const p = verify(tok, "access");
      if (p && p.aud === RESOURCE) return next();                      // Claude web / Desktop connector
    }
  }
  const challenge = `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"` + (tok ? `, error="invalid_token"` : "");
  res.setHeader("WWW-Authenticate", challenge);
  res.status(401).json({ error: tok ? "invalid_token" : "unauthorized" });
}
