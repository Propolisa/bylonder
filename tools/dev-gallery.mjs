// A gallery of the running dev servers and the latest pictures, for following the work from a phone on the home
// network, installable as an app (PWA). Everything it keeps is in .tools/dev-gallery/ (git-ignored): a shared key, and a
// local certificate authority (ca.crt) whose certificate the phone installs once, so the HTTPS pages are trusted and the
// app installs. Sign in with the key once; the browser keeps a cookie. Each dev server on localhost is proxied on its
// own port (its port + 3000, e.g. 5311 at 8311), websockets included, behind the same key.
// usage: node tools/dev-gallery.mjs [--port 8443]
import { createServer } from "node:https";
import { request } from "node:http";
import { connect } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { TOOLS } from "../tests/e2e/tools.mjs";
import { ffmpeg } from "./media.mjs";

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
// Where pictures come from, by kind: the worktrees' docs media, their .shots (side-by-side and parity comparisons, and
// the agents' bug and test pictures in .shots/agents/), and the session scratchpads and test failure screenshots in
// the temporary folder (GALLERY_TEMP: another folder to look in).
const TEMP = process.env.GALLERY_TEMP ?? process.env.TEMP ?? "/tmp";
const worktrees = () => readdirSync(parent).filter((n) => n.startsWith("bylonder")).map((n) => join(parent, n));
const SOURCES = {
  docs: () => worktrees().map((t) => join(t, "docs", "media")),
  comparisons: () => worktrees().map((t) => join(t, ".shots")),
  testing: () => [join(TEMP, "claude"), TEMP],
};
const KINDS = { docs: "Docs media", comparisons: "Side by side", testing: "Testing and bug fixes" };
const roots = () => Object.values(SOURCES).flatMap((s) => s());
// The pictures of each kind, newest first; the temporary folder's own files only as test screenshots (e2e-*,
// prod-check). The folders are walked at most every few seconds, however often the pages ask.
let found = [], walked = 0;
function pictures() {
  if (Date.now() - walked < 3000) return found;
  const all = [];
  const walk = (d, depth, kind, top) => {
    if (depth > 8 || !existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) { if (!top && entry.name !== "node_modules") walk(path, depth + 1, kind, false); }
      else if (/\.(png|gif|jpg)$/i.test(entry.name) && (!top || /^(e2e-|prod-check)/.test(entry.name))) all.push({ path, kind, mtime: statSync(path).mtimeMs });
    }
  };
  for (const [kind, source] of Object.entries(SOURCES)) for (const d of source()) walk(d, 0, kind, d === TEMP);
  found = all.sort((a, b) => b.mtime - a.mtime);
  walked = Date.now();
  return found;
}
// A page of pictures as JSON: the kinds asked for, older than `before` (the next page) or newer than `after` (new ones).
function picturesPage(req, res) {
  const q = new URL(req.url, "https://x").searchParams, kinds = (q.get("kinds") ?? "").split(",");
  const before = Number(q.get("before") ?? Infinity), after = Number(q.get("after") ?? -Infinity);
  const page = pictures().filter((p) => kinds.includes(p.kind) && p.mtime < before && p.mtime > after).slice(0, 30);
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(page.map((p) => ({ ...p, name: p.path.split(/[\\/]/).slice(-3).join("/") }))));
}

const STYLE = `body{margin:0;font:15px system-ui;background:#1d1d1d;color:#ddd}h2{padding:12px 16px 0;font-size:16px}a{color:#8cf}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:12px 16px}
.card{background:#2a2a2a;border-radius:8px;overflow:hidden}.card img{width:100%;aspect-ratio:16/9;object-fit:contain;display:block;background:#333}
.card p{margin:6px 8px;font-size:12px;word-break:break-all}.kinds{padding:0 16px}.kinds label{margin-right:14px;white-space:nowrap}
#more{padding:16px;text-align:center;color:#888}form{padding:24px 16px}input,button{font:16px system-ui;padding:10px;border-radius:6px;border:0}input[name=key]{width:16em}`;
const page = (body) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta name=theme-color content="#1d1d1d">
<link rel=manifest href="/manifest.json"><link rel=icon href="/icon.svg"><title>Bylonder dev</title><style>${STYLE}</style>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js")</script>${body}`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d1d1d"/><circle cx="32" cy="34" r="16" fill="none" stroke="#e87d0d" stroke-width="6"/><circle cx="32" cy="34" r="6" fill="#4772b3"/></svg>`;
const MANIFEST = JSON.stringify({ name: "Bylonder dev", short_name: "Bylonder", start_url: "/", display: "standalone", background_color: "#1d1d1d", theme_color: "#1d1d1d",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });
// Network first: the gallery is always fresh when the machine is reachable.
const WORKER = `self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));`;

// The page loads pictures a page at a time as it scrolls, as small thumbnails (the full picture on a tap), and follows
// new ones: they come in at the top, and with Follow on the page scrolls up to them.
const CLIENT = `
const shown = JSON.parse(localStorage.getItem("kinds") || "{}"), grid = document.getElementById("pictures"), more = document.getElementById("more");
const follow = document.getElementById("follow");
follow.checked = localStorage.getItem("follow") !== "off";
follow.onchange = () => { localStorage.setItem("follow", follow.checked ? "on" : "off"); if (follow.checked) scrollTo({ top: 0, behavior: "smooth" }); };
let newest = -Infinity, oldest = Infinity, done = false, loading = false;
const kinds = () => [...document.querySelectorAll("input[data-kind]")].filter((b) => b.checked).map((b) => b.dataset.kind).join(",");
const card = (p) => { const d = document.createElement("div"), url = "/file?path=" + encodeURIComponent(p.path);
  d.className = "card"; d.innerHTML = '<a href="' + url + '"><img loading=lazy decoding=async src="/thumb?path=' + encodeURIComponent(p.path) + '&t=' + p.mtime + '"></a><p></p>';
  d.querySelector("p").textContent = p.name + " · " + new Date(p.mtime).toLocaleString(); return d; };
const get = async (q) => (await fetch("/pictures?kinds=" + kinds() + "&" + q, { cache: "no-store" })).json();
async function older() {
  if (loading || done) return;
  loading = true;
  const page = await get(oldest < Infinity ? "before=" + oldest : "");
  page.forEach((p) => { grid.append(card(p)); newest = Math.max(newest, p.mtime); oldest = Math.min(oldest, p.mtime); });
  done = page.length === 0; more.textContent = done ? "No more pictures" : "Loading...";
  loading = false;
  if (!done && more.getBoundingClientRect().top < innerHeight * 2) older();
}
async function newer() {
  if (newest === -Infinity) return older();
  const page = await get("after=" + newest);
  page.reverse().forEach((p) => { grid.prepend(card(p)); newest = Math.max(newest, p.mtime); });
  if (page.length && follow.checked) scrollTo({ top: 0, behavior: "smooth" });
}
function restart() { grid.replaceChildren(); newest = -Infinity; oldest = Infinity; done = false; older(); }
document.querySelectorAll("input[data-kind]").forEach((box) => {
  box.checked = shown[box.dataset.kind] !== false;
  box.onchange = () => { shown[box.dataset.kind] = box.checked; localStorage.setItem("kinds", JSON.stringify(shown)); restart(); };
});
new IntersectionObserver((e) => { if (e[0].isIntersecting) older(); }, { rootMargin: "1000px" }).observe(more);
setInterval(async () => {
  newer();
  const servers = document.getElementById("servers"), fresh = await (await fetch("/servers", { cache: "no-store" })).text();
  if (servers.innerHTML !== fresh) servers.innerHTML = fresh;
}, 5000);
older();`;

const serverCards = async () => (await servers()).map((s) => `<div class=card><p><a href="${s.url}">${s.name || "localhost"}:${s.port}</a></p></div>`).join("") || "<p>none running</p>";
async function gallery(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page(`<h2>Dev servers</h2><div class=grid id=servers>${await serverCards()}</div>
<h2>Latest pictures</h2><p class=kinds>${Object.entries(KINDS).map(([kind, label]) => `<label><input type=checkbox data-kind=${kind} checked> ${label}</label>`).join(" ")}
<label><input type=checkbox id=follow checked> Follow new pictures</label></p>
<div class=grid id=pictures></div><p id=more>Loading...</p><script>${CLIENT}</script>`));
}

// A picture under one of the sources' folders, by its full path.
const allowed = (path) => roots().some((r) => path.toLowerCase().startsWith(r.toLowerCase())) && !path.includes("..") && /\.(png|gif|jpg)$/i.test(path) && existsSync(path);
const pathOf = (req) => new URL(req.url, "https://x").searchParams.get("path") ?? "";
function serveFile(req, res) {
  const path = pathOf(req);
  if (!allowed(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": path.endsWith(".gif") ? "image/gif" : path.endsWith(".png") ? "image/png" : "image/jpeg" });
  res.end(readFileSync(path));
}
// A small JPEG of a picture (a GIF's first frame), made once by ffmpeg and kept in .tools/dev-gallery/thumbs.
const thumbs = join(dir, "thumbs");
function serveThumb(req, res) {
  const path = pathOf(req);
  if (!allowed(path)) { res.writeHead(404); return res.end(); }
  const thumb = join(thumbs, createHash("sha1").update(path + statSync(path).mtimeMs).digest("hex") + ".jpg");
  const send = () => { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000, immutable" }); res.end(readFileSync(thumb)); };
  if (existsSync(thumb)) return send();
  mkdirSync(thumbs, { recursive: true });
  execFile(ffmpeg, ["-v", "error", "-i", path, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", "-y", thumb], (error) => {
    if (error || !existsSync(thumb)) { res.writeHead(500); return res.end(); }
    send();
  });
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
  if (path === "/file") return serveFile(req, res);
  if (path === "/thumb") return serveThumb(req, res);
  if (path === "/pictures") return picturesPage(req, res);
  if (path === "/servers") return serverCards().then((html) => send(res, "text/html; charset=utf-8", html));
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
