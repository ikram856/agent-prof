/* Tests automatiques de MEHDI 2.0 (sécurité + fonctionnement).
   Lancer : npm test
   Le serveur est démarré dans un dossier temporaire avec un faux Gemini : aucune donnée réelle n'est touchée. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-gemini.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LESSON = "les-seismes-test";
let mock, srv, B, tmp;

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

/* Petit client HTTP qui garde son cookie de session (un « navigateur » par personne) */
function client() {
  let cookie = "";
  const call = async (method, url, body, headers = {}) => {
    const isJSON = body !== undefined && typeof body !== "string";
    const r = await fetch(B + url, {
      method, redirect: "manual",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(isJSON ? { "Content-Type": "application/json" } : {}), ...headers },
      body: isJSON ? JSON.stringify(body) : body
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers, setCookie: sc };
  };
  return {
    get: (u, h) => call("GET", u, undefined, h),
    post: (u, b, h) => call("POST", u, b, h),
    put: (u, b, h) => call("PUT", u, b, h),
    del: (u, h) => call("DELETE", u, undefined, h)
  };
}
/* Lit la réponse en morceaux de /api/chat */
const ndjson = txt => String(txt).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

const prof = client(), sara = client(), yassine = client(), anonyme = client();

before(async () => {
  mock = await startMock();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mehdi-test-"));
  fs.mkdirSync(path.join(tmp, "cours"));
  fs.copyFileSync(path.join(ROOT, "test/fixtures/cours", LESSON + ".json"), path.join(tmp, "cours", LESSON + ".json"));
  const port = await freePort();
  B = "http://127.0.0.1:" + port;
  srv = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), GEMINI_API_KEY: "test", GEMINI_BASE_URL: mock.url, GEMINI_MODEL: "faux-flash-lite", GEMINI_FALLBACKS: "faux-flash",
      DATA_DIR: path.join(tmp, "data"), COURS_DIR: path.join(tmp, "cours"), PROF_PASSWORD: "",
      GEMINI_CACHE_MIN_CHARS: "200" },   // le cours de test est court : on force le cache pour le tester
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Le serveur n'a pas démarré :\n" + out)), 10000);
    srv.stdout.on("data", d => { out += d; if (out.includes("Serveur prêt")) { clearTimeout(t); resolve(); } });
    srv.stderr.on("data", d => { out += d; });
    srv.on("exit", c => { clearTimeout(t); reject(new Error("Le serveur s'est arrêté (" + c + ") :\n" + out)); });
  });
});
after(async () => {
  srv?.kill();
  await mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ---------- En-têtes de sécurité ---------- */
test("les en-têtes de sécurité sont envoyés sur les pages et l'API", async () => {
  for (const u of ["/login.html", "/api/me"]) {
    const { headers } = await anonyme.get(u);
    const csp = headers.get("content-security-policy");
    assert.match(csp, /script-src 'self' 'sha256-/, "CSP avec empreintes de scripts");
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, "pas de 'unsafe-inline' pour les scripts");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("referrer-policy"), "no-referrer");
  }
});

/* ---------- Premier lancement et connexion ---------- */
test("premier lancement : création du compte professeur une seule fois", async () => {
  const me = await anonyme.get("/api/me");
  assert.equal(me.status, 401);
  assert.equal(me.data.setup, true);
  assert.equal((await anonyme.post("/api/setup", { password: "123" })).status, 400, "mot de passe trop court refusé");
  const r = await prof.post("/api/setup", { password: "Secret-Prof-2026" });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
  assert.equal((await anonyme.post("/api/setup", { password: "autre-mot-de-passe" })).status, 403, "impossible de recréer le compte");
  assert.equal((await prof.get("/api/me")).data.role, "prof");
});

test("le prof crée deux classes et range la leçon dans la première", async () => {
  assert.equal((await prof.post("/api/classes", { name: "1re année", password: "1ac-test" })).status, 200);
  assert.equal((await prof.post("/api/classes", { name: "2e année", password: "2ac-test" })).status, 200);
  assert.equal((await prof.post("/api/classes", { name: "1re année", password: "xxxx" })).status, 400, "doublon refusé");
  assert.equal((await prof.put("/api/lessons", { id: LESSON, classId: "1re-annee" })).status, 200);
});

test("connexion élève : mauvais mot de passe refusé, bon accepté", async () => {
  assert.equal((await sara.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Sara", password: "faux" })).status, 401);
  assert.equal((await sara.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "", password: "1ac-test" })).status, 400);
  assert.equal((await sara.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Sara", password: "1ac-test" })).status, 200);
  assert.equal((await yassine.post("/api/login", { role: "eleve", classId: "2e-annee", prenom: "Yassine", password: "2ac-test" })).status, 200);
  const me = await sara.get("/api/me");
  assert.equal(me.data.role, "eleve");
  assert.equal(me.data.student, "Sara");
});

test("trop d'essais : seul le compte visé est bloqué, pas toute la classe", async () => {
  const pirate = client();
  for (let i = 0; i < 10; i++) await pirate.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Pirate", password: "x" + i });
  assert.equal((await pirate.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Pirate", password: "1ac-test" })).status, 429);
  const autre = client();
  assert.equal((await autre.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Nora", password: "1ac-test" })).status, 200);
});

/* ---------- Droits ---------- */
test("un élève ne peut pas utiliser les fonctions du professeur", async () => {
  assert.equal((await sara.get("/api/classes")).status, 403);
  assert.equal((await sara.post("/api/classes", { name: "Pirate", password: "xxxx" })).status, 403);
  assert.equal((await sara.put("/api/resume", { lessonId: LESSON, texte: "piraté" })).status, 403);
  assert.equal((await sara.put("/api/profile", { nom: "Pirate" })).status, 403);
  assert.equal((await sara.del("/api/history?id=x")).status, 403);
  assert.equal((await sara.post("/api/lessons?filename=a.txt", "contenu du cours piraté".repeat(5), { "Content-Type": "text/plain" })).status, 403);
  assert.equal((await sara.post("/api/fetch-url", { urls: ["https://example.com"] })).status, 403);
});

test("une personne non connectée n'a accès à rien", async () => {
  for (const u of ["/api/lessons", "/api/history", "/api/conv?mode=cours", "/api/profile", "/api/resume?lessonId=" + LESSON])
    assert.equal((await anonyme.get(u)).status, 401, u);
});

test("une classe ne voit pas les leçons ni les résumés d'une autre classe", async () => {
  assert.ok((await sara.get("/api/lessons")).data.lessons.some(l => l.id === LESSON));
  assert.ok(!(await yassine.get("/api/lessons")).data.lessons.some(l => l.id === LESSON));
  assert.equal((await yassine.get("/api/resume?lessonId=" + LESSON)).status, 404);
});

/* ---------- Discussion et historique ---------- */
test("le débat démarre tout seul sur le cours, puis l'élève répond", async () => {
  const k = await sara.post("/api/chat", { mode: "debat", kickoff: true, lessonId: LESSON });
  assert.equal(k.status, 200);
  const parts = ndjson(k.data);
  assert.ok(parts.some(p => p.done));
  assert.match(parts.map(p => p.d || "").join(""), /Question de débat/);
  const m = ndjson((await sara.post("/api/chat", { mode: "debat", text: "Je suis CONTRE", lessonId: LESSON })).data);
  assert.match(m.map(p => p.d || "").join(""), /Je suis CONTRE/);
  const { conv } = (await sara.get("/api/conv?mode=debat")).data;
  assert.equal(conv.messages.length, 3, "le message caché de lancement n'est pas montré");
  assert.equal(conv.lessonId, LESSON);
});

test("un élève ne peut pas lire la conversation d'un autre élève", async () => {
  const { conv } = (await sara.get("/api/conv?mode=debat")).data;
  assert.equal((await yassine.get("/api/history/one?id=" + conv.id)).status, 404);
  assert.equal((await yassine.get("/api/history")).data.conversations.length, 0);
  assert.equal((await sara.get("/api/history")).data.conversations.length, 1);
});

test("le professeur voit l'historique de tous les élèves", async () => {
  await yassine.post("/api/chat", { mode: "cours", text: "C'est quoi un foyer ?" });
  const list = (await prof.get("/api/history")).data.conversations;
  assert.deepEqual(new Set(list.map(c => c.student)), new Set(["Sara", "Yassine"]));
  const only2 = (await prof.get("/api/history?classId=2e-annee")).data.conversations;
  assert.ok(only2.every(c => c.student === "Yassine"));
});

/* ---------- Cache de contexte ---------- */
test("cache : un seul cache pour toutes les questions sur la même leçon", async () => {
  const avant = { ...mock.stats };
  const nora = client();
  await nora.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: "Nora", password: "1ac-test" });
  for (const [qui, texte] of [[sara, "C'est quoi le foyer ?"], [nora, "Et l'épicentre ?"], [sara, "Donne un exemple"]]) {
    const parts = ndjson((await qui.post("/api/chat", { mode: "cours", text: texte, lessonId: LESSON })).data);
    assert.ok(parts.some(p => p.done), texte);
  }
  assert.equal(mock.stats.cachesCreated - avant.cachesCreated, 1, "un seul cache pour les 3 questions");
  assert.equal(mock.stats.cachedRequests - avant.cachedRequests, 3, "les 3 questions utilisent le cache");
});

test("cache expiré chez Google : la réponse arrive quand même", async () => {
  mock.expireAll();
  const avant = mock.stats.plainRequests;
  const parts = ndjson((await sara.post("/api/chat", { mode: "cours", text: "Encore une question", lessonId: LESSON })).data);
  assert.ok(parts.some(p => p.done), "réponse complète");
  assert.match(parts.map(p => p.d || "").join(""), /Encore une question/);
  assert.equal(mock.stats.plainRequests - avant, 1, "nouvel essai sans cache");
});

test("les résumés de cours n'utilisent pas le cache (demande ponctuelle)", async () => {
  const avant = mock.stats.cachesCreated;
  assert.equal((await prof.post("/api/resume/generate", { lessonId: LESSON })).status, 200);
  assert.equal(mock.stats.cachesCreated, avant);
});

/* ---------- Résumés et signature ---------- */
test("le prof prépare un résumé, l'élève de la classe peut le lire", async () => {
  const g = await prof.post("/api/resume/generate", { lessonId: LESSON });
  assert.equal(g.status, 200);
  assert.match(g.data.carte, /^Les séismes/);
  assert.equal((await prof.put("/api/resume", { lessonId: LESSON, ...g.data })).status, 200);
  const r = await sara.get("/api/resume?lessonId=" + LESSON);
  assert.match(r.data.texte, /vibration du sol/);
});

test("seule une vraie image PNG est acceptée comme signature", async () => {
  assert.equal((await prof.put("/api/profile", { signature: "javascript:alert(1)" })).status, 400);
  assert.equal((await prof.put("/api/profile", { signature: "data:image/svg+xml;base64,PHN2Zz4=" })).status, 400);
  assert.equal((await prof.put("/api/profile", { signature: "data:image/png;base64,iVBORw0KGgo=" })).status, 200);
});

/* ---------- Attaques classiques ---------- */
test("CSRF : une requête venant d'un autre site est refusée", async () => {
  const r = await sara.post("/api/conv/new", { mode: "debat" }, { Origin: "https://site-pirate.example" });
  assert.equal(r.status, 403);
  assert.equal((await sara.get("/api/conv?mode=debat")).data.conv.messages.length, 3, "rien n'a été modifié");
});

test("SSRF : l'import par liens refuse le PC lui-même et le réseau local", async () => {
  // Cette page existe et contient du HTML : sans protection, elle serait importée comme un cours
  const interne = "http://127.0.0.1:" + new URL(B).port + "/login.html";
  const cas = [
    [interne, /Adresse interne ou privée refusée|Port non autorisé/],
    ["http://localhost/", /Adresse interne ou privée refusée/],
    ["http://[::1]/", /Adresse interne ou privée refusée/],
    ["http://169.254.169.254/latest/meta-data/", /Adresse interne ou privée refusée/],
    ["http://192.168.1.1/", /Adresse interne ou privée refusée/],
    ["http://10.0.0.1/", /Adresse interne ou privée refusée/],
    ["http://[::ffff:127.0.0.1]/", /Adresse interne ou privée refusée/],
    ["file:///etc/passwd", /Seuls les liens http et https|Protocole/],
    ["http://exemple.com:22/", /Port non autorisé/]
  ];
  for (const [u, motif] of cas) {
    const r = await prof.post("/api/fetch-url", { urls: [u], name: "test" });
    assert.equal(r.status, 400, u);
    assert.match(r.data.error, motif, u);
  }
});

test("traversée de dossier : impossible de lire le code ou les données du serveur", async () => {
  for (const u of ["/../server.mjs", "/..%2fserver.mjs", "/%2e%2e/%2e%2e/data/config.json", "/..%5cserver.mjs", "/public/../.env"]) {
    const r = await anonyme.get(u);
    assert.ok([400, 404].includes(r.status), u + " → " + r.status);
    assert.doesNotMatch(String(r.data), /GEMINI|profHash|import http/);
  }
});

test("une adresse mal formée ne fait pas planter le serveur", async () => {
  assert.equal((await anonyme.get("/%E0%A4%A")).status, 400);
  assert.equal((await anonyme.get("/login.html")).status, 200, "le serveur répond toujours");
});

test("le prénom est enregistré comme du texte, sans être interprété", async () => {
  const x = client();
  const nom = "<img src=x onerror=alert(1)>";
  assert.equal((await x.post("/api/login", { role: "eleve", classId: "1re-annee", prenom: nom, password: "1ac-test" })).status, 200);
  assert.equal((await x.get("/api/me")).data.student, nom);
  assert.match((await x.get("/api/me")).headers.get("content-type"), /application\/json/);
});

test("déconnexion : la session ne marche plus", async () => {
  const x = client();
  await x.post("/api/login", { role: "eleve", classId: "2e-annee", prenom: "Adam", password: "2ac-test" });
  assert.equal((await x.get("/api/me")).status, 200);
  await x.post("/api/logout");
  assert.equal((await x.get("/api/me")).status, 401);
});
