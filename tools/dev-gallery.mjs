// A gallery of the running dev servers and the latest pictures, for following the work from a phone on the home
// network, installable as an app (PWA). Everything it keeps is in .tools/dev-gallery/ (git-ignored): a shared key, and a
// local certificate authority (ca.crt) whose certificate the phone installs once, so the HTTPS pages are trusted and the
// app installs. Sign in with the key once; the browser keeps a cookie. Each dev server on localhost is proxied on its
// own port (its port + 3000, e.g. 5311 at 8311), websockets included, behind the same key.
// usage: node tools/dev-gallery.mjs [--port 8443]
import { createServer } from "node:https";
import { request } from "node:http";
import { connect } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { TOOLS } from "../tests/e2e/tools.mjs";

const forge = createRequire(import.meta.url)("node-forge");
const root = fileURLToPath(new URL("..", import.meta.url)), parent = dirname(root.replace(/[\\/]$/, ""));
const args = process.argv.slice(2);
const PORT = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 8443);
const DEV_PORTS = [5173, 5205, ...Array.from({ length: 20 }, (_, i) => 5300 + i)];
const OFFSET = 3000;
const dir = join(TOOLS.root, "dev-gallery");
mkdirSync(dir, { recursive: true });

const lan = Object.values(networkInterfaces()).flat().find((a) => a.family === "IPv4" && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a.address))?.address ?? "localhost";
const kept = (name, make) => (existsSync(join(dir, name)) || writeFileSync(join(dir, name), make()), readFileSync(join(dir, name), "utf8"));
const key = kept("key", () => randomBytes(24).toString("base64url"));

// A certificate signed by `issuer` (itself when none: the authority's own).
function certificate(subject, keys, issuer, extensions, years) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + years * 365 * 86400000);
  cert.setSubject([{ name: "commonName", value: subject }]);
  cert.setIssuer([{ name: "commonName", value: issuer?.subject ?? subject }]);
  cert.setExtensions(extensions);
  cert.sign(issuer?.key ?? keys.privateKey, forge.md.sha256.create());
  return cert;
}
const authority = JSON.parse(kept("ca.json", () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = certificate("Bylonder dev gallery CA", keys, null, [{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true }], 10);
  return JSON.stringify({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) });
}));
kept("ca.crt", () => authority.cert);
// The server's certificate for this machine's address, made again when the address changes.
const server = JSON.parse(kept(`server-${lan}.json`, () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = certificate(lan, keys, { subject: "Bylonder dev gallery CA", key: forge.pki.privateKeyFromPem(authority.key) },
    [{ name: "subjectAltName", altNames: [{ type: 7, ip: lan }, { type: 2, value: "localhost" }] }, { name: "extKeyUsage", serverAuth: true }], 2);
  return JSON.stringify({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) + authority.cert });
}));

const COOKIE = "bylonder_gallery";
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")))[COOKIE] ?? "";
const signedIn = (req) => same(cookieOf(req), key);
const signIn = (res) => res.setHeader("Set-Cookie", `${COOKIE}=${key}; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000; Path=/`);

const alive = (port) => new Promise((done) => {
  const socket = connect({ port, host: "localhost", autoSelectFamily: true }, () => { socket.destroy(); done(true); });
  socket.on("error", () => done(false));
});
// The worktree a dev server serves: the folder of the process listening on its port (Windows).
function worktreeOf(port) {
  if (process.platform !== "win32") return "";
  try {
    const command = createRequire(import.meta.url)("node:child_process").execFileSync("powershell", ["-NoProfile", "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=$((Get-NetTCPConnection -LocalPort ${port} -State Listen)[0].OwningProcess)").CommandLine`], { encoding: "utf8" });
    return command.match(/(bylonder[\w-]*)[\\/]node_modules/)?.[1] ?? "";
  } catch { return ""; }
}
async function servers() {
  const ports = (await Promise.all(DEV_PORTS.map(async (p) => ((await alive(p)) ? p : null)))).filter(Boolean);
  return ports.map((port) => ({ port, name: worktreeOf(port), url: `https://${lan}:${port + OFFSET}/` }));
}
// The newest pictures in the worktrees' docs media and .shots.
function pictures(limit = 60) {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 6 || !existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (/\.(png|gif|jpg)$/i.test(entry.name)) found.push({ path, mtime: statSync(path).mtimeMs });
    }
  };
  for (const tree of readdirSync(parent).filter((n) => n.startsWith("bylonder")).map((n) => join(parent, n))) {
    walk(join(tree, "docs", "media"), 0);
    walk(join(tree, ".shots"), 0);
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

const STYLE = `body{margin:0;font:15px system-ui;background:#1d1d1d;color:#ddd}h2{padding:12px 16px 0;font-size:16px}a{color:#8cf}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:12px 16px}
.card{background:#2a2a2a;border-radius:8px;overflow:hidden}.card img{width:100%;display:block}.card p{margin:6px 8px;font-size:12px;word-break:break-all}
form{padding:24px 16px}input,button{font:16px system-ui;padding:10px;border-radius:6px;border:0}input{width:16em}`;
const page = (body) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta name=theme-color content="#1d1d1d">
<link rel=manifest href="/manifest.json"><link rel=icon href="/icon.svg"><title>Bylonder dev</title><style>${STYLE}</style>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js")</script>${body}`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d1d1d"/><circle cx="32" cy="34" r="16" fill="none" stroke="#e87d0d" stroke-width="6"/><circle cx="32" cy="34" r="6" fill="#4772b3"/></svg>`;
const MANIFEST = JSON.stringify({ name: "Bylonder dev", short_name: "Bylonder", start_url: "/", display: "standalone", background_color: "#1d1d1d", theme_color: "#1d1d1d",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });
// Network first: the gallery is always fresh when the machine is reachable.
const WORKER = `self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));`;

async function gallery(res) {
  const list = await servers(), shots = pictures();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page(`<h2>Dev servers</h2><div class=grid>${list.map((s) => `<div class=card><p><a href="${s.url}">${s.name || "localhost"}:${s.port}</a></p></div>`).join("") || "<p>none running</p>"}</div>
<h2>Latest pictures</h2><div class=grid>${shots.map((s) => { const rel = relative(parent, s.path).replaceAll("\\", "/"); return `<div class=card><a href="/file/${encodeURI(rel)}"><img loading=lazy src="/file/${encodeURI(rel)}"></a><p>${rel} · ${new Date(s.mtime).toLocaleTimeString()}</p></div>`; }).join("")}</div>`));
}

function serveFile(req, res) {
  const path = join(parent, decodeURIComponent(req.url.slice("/file/".length).split("?")[0]));
  if (!path.startsWith(parent) || !/\.(png|gif|jpg)$/i.test(path) || !existsSync(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": path.endsWith(".gif") ? "image/gif" : path.endsWith(".png") ? "image/png" : "image/jpeg" });
  res.end(readFileSync(path));
}

const send = (res, type, body) => { res.writeHead(200, { "Content-Type": type }); res.end(body); };
const PUBLIC = { "/manifest.json": ["application/manifest+json", MANIFEST], "/icon.svg": ["image/svg+xml", ICON], "/sw.js": ["text/javascript", WORKER],
  "/ca.crt": ["application/x-x509-ca-cert", authority.cert] };
function signInPage(res, failed) {
  res.writeHead(failed ? 401 : 200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page(`<form method=post action="/sign-in"><h2>Bylonder dev</h2><p>${failed ? "Wrong key." : "Enter the shared key."}</p>
<input name=key type=password autocomplete=current-password autofocus> <button>Sign in</button>
<p><a href="/ca.crt">Certificate authority</a> to install on the phone once.</p></form>`));
}

createServer(server, (req, res) => {
  const path = req.url.split("?")[0];
  if (PUBLIC[path]) return send(res, ...PUBLIC[path]);
  if (path === "/sign-in" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 4096) req.destroy(); });
    return req.on("end", () => {
      const given = new URLSearchParams(body).get("key") ?? "";
      if (!same(given, key)) return signInPage(res, true);
      signIn(res);
      res.writeHead(303, { Location: "/" });
      res.end();
    });
  }
  if (!signedIn(req)) return signInPage(res, false);
  if (path.startsWith("/file/")) return serveFile(req, res);
  gallery(res);
}).listen(PORT, "0.0.0.0");

// A dev server behind the key: HTTP and its HMR websocket, to localhost.
for (const port of DEV_PORTS) {
  const proxy = createServer(server, (req, res) => {
    if (!signedIn(req)) { res.writeHead(302, { Location: `https://${lan}:${PORT}/` }); return res.end(); }
    const upstream = request({ host: "localhost", port, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${port}` }, autoSelectFamily: true }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end("Dev server not running"); });
    req.pipe(upstream);
  });
  proxy.on("upgrade", (req, socket, head) => {
    if (!signedIn(req)) return socket.destroy();
    const up = connect({ port, host: "localhost", autoSelectFamily: true }, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({ ...req.headers, host: `localhost:${port}` }).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
      up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  proxy.listen(port + OFFSET, "0.0.0.0");
}
console.log(`Dev gallery: https://${lan}:${PORT}/  (key in ${join(dir, "key")}; the phone installs ${join(dir, "ca.crt")} once)`);
