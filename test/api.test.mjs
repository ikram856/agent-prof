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
  assert.equal((await prof.post("/api/classes", { name: "1re année" })).status, 200);
  assert.equal((await prof.post("/api/classes", { name: "2e année" })).status, 200);
  assert.equal((await prof.post("/api/classes", { name: "1re année" })).status, 400, "doublon refusé");
  assert.equal((await prof.put("/api/lessons", { id: LESSON, classId: "1re-annee" })).status, 200);
});

/* Comptes élèves créés par le prof : nom -> { login, password } */
const comptes = {};
const connecter = (c, nom, pw = comptes[nom].password) => c.post("/api/login", { role: "eleve", login: comptes[nom].login, password: pw });

test("le prof crée un compte par élève, chacun avec son mot de passe", async () => {
  const r1 = await prof.post("/api/students", { classId: "1re-annee", names: "Sara Benali\nNora Idrissi\n\nNora Idrissi\n<img src=x onerror=alert(1)>" });
  assert.equal(r1.status, 200);
  const r2 = await prof.post("/api/students", { classId: "2e-annee", names: ["Yassine El Amrani", "Adam Alaoui"] });
  for (const e of [...r1.data.created, ...r2.data.created]) comptes[e.name in comptes ? e.name + " (2)" : e.name] = e;
  assert.equal(r1.data.created.length, 4, "la ligne vide est ignorée");
  assert.equal(comptes["Sara Benali"].login, "sara.benali");
  assert.notEqual(comptes["Nora Idrissi"].login, comptes["Nora Idrissi (2)"].login, "deux homonymes ont deux identifiants");
  const pws = Object.values(comptes).map(e => e.password);
  assert.equal(new Set(pws).size, pws.length, "mots de passe tous différents");
  assert.ok(pws.every(p => p.length >= 10));
  // la liste ne montre jamais les mots de passe
  const list = (await prof.get("/api/students?classId=1re-annee")).data.students;
  assert.equal(list.length, 4);
  assert.ok(list.every(e => !("password" in e) && !("hash" in e)));
  assert.doesNotMatch(JSON.stringify(list), new RegExp(comptes["Sara Benali"].password));
  assert.equal((await prof.post("/api/students", { classId: "inexistante", names: ["X Y"] })).status, 400);
});

test("connexion élève : mauvais mot de passe refusé, bon accepté", async () => {
  assert.equal((await connecter(sara, "Sara Benali", "faux")).status, 401);
  assert.equal((await connecter(sara, "Sara Benali", comptes["Nora Idrissi"].password)).status, 401, "le mot de passe d'un camarade ne marche pas");
  assert.equal((await sara.post("/api/login", { role: "eleve", login: "", password: "x" })).status, 400);
  assert.equal((await connecter(sara, "Sara Benali")).status, 200);
  assert.equal((await yassine.post("/api/login", { role: "eleve", login: " " + comptes["Yassine El Amrani"].login.toUpperCase() + " ", password: comptes["Yassine El Amrani"].password })).status, 200, "identifiant sans souci de majuscules");
  const me = await sara.get("/api/me");
  assert.equal(me.data.role, "eleve");
  assert.equal(me.data.student, "Sara Benali");
  assert.equal(me.data.classId, "1re-annee");
});

test("trop d'essais : seul le compte visé est bloqué, pas toute la classe", async () => {
  const pirate = client();
  for (let i = 0; i < 10; i++) await connecter(pirate, "Nora Idrissi (2)", "x" + i);
  assert.equal((await connecter(pirate, "Nora Idrissi (2)")).status, 429);
  assert.equal((await connecter(client(), "Nora Idrissi")).status, 200);
});

test("nouveau mot de passe : l'ancien ne marche plus et la session est fermée", async () => {
  const x = client();
  assert.equal((await connecter(x, "Adam Alaoui")).status, 200);
  const r = await prof.post("/api/students/reset", { id: comptes["Adam Alaoui"].id });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.password, comptes["Adam Alaoui"].password);
  assert.equal((await x.get("/api/me")).status, 401, "l'ancienne session est fermée");
  assert.equal((await connecter(client(), "Adam Alaoui")).status, 401, "ancien mot de passe refusé");
  comptes["Adam Alaoui"].password = r.data.password;
  assert.equal((await connecter(client(), "Adam Alaoui")).status, 200);
});

/* ---------- Droits ---------- */
test("un élève ne peut pas utiliser les fonctions du professeur", async () => {
  assert.equal((await sara.get("/api/classes")).status, 403);
  assert.equal((await sara.post("/api/classes", { name: "Pirate" })).status, 403);
  assert.equal((await sara.get("/api/students?classId=1re-annee")).status, 403);
  assert.equal((await sara.post("/api/students", { classId: "1re-annee", names: ["Faux Élève"] })).status, 403);
  assert.equal((await sara.post("/api/students/reset", { id: comptes["Nora Idrissi"].id })).status, 403);
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
  assert.deepEqual(new Set(list.map(c => c.student)), new Set(["Sara Benali", "Yassine El Amrani"]));
  const only2 = (await prof.get("/api/history?classId=2e-annee")).data.conversations;
  assert.ok(only2.every(c => c.student === "Yassine El Amrani"));
});

/* ---------- Résumés de séance ---------- */
test("l'élève fait le résumé de sa séance (gardé, pas refait pour rien)", async () => {
  const r = await sara.post("/api/conv/summary", { mode: "debat" });
  assert.equal(r.status, 200);
  assert.match(r.data.summary.texte, /Résumé pour élève : 1 question/, "écrit pour l'élève, à partir de ses messages (sans le message caché)");
  const avant = mock.stats.plainRequests;
  const r2 = await sara.post("/api/conv/summary", { mode: "debat" });
  assert.equal(r2.data.summary.updated, r.data.summary.updated, "même résumé");
  assert.equal(mock.stats.plainRequests, avant, "aucun nouvel appel à l'IA");
  const { conv } = (await sara.get("/api/conv?mode=debat")).data;
  assert.equal(conv.summary.texte, r.data.summary.texte, "le résumé revient avec la conversation");
  assert.equal((await sara.post("/api/conv/summary", { mode: "quiz" })).status, 404, "pas de conversation, pas de résumé");
});

test("le prof a son propre bilan ; un autre élève ne peut pas résumer la conversation", async () => {
  const { conv } = (await sara.get("/api/conv?mode=debat")).data;
  assert.equal((await yassine.post("/api/conv/summary", { id: conv.id })).status, 404);
  const r = await prof.post("/api/conv/summary", { id: conv.id });
  assert.equal(r.status, 200);
  assert.match(r.data.summary.texte, /Résumé pour prof/);
  assert.match((await prof.get("/api/history/one?id=" + conv.id)).data.conv.summary.texte, /pour prof/);
  assert.match((await sara.get("/api/history/one?id=" + conv.id)).data.conv.summary.texte, /pour élève/, "l'élève garde sa version");
});

test("résumé de la séance d'une classe : toutes les questions du jour, pour le prof seulement", async () => {
  const date = new Date().toISOString().slice(0, 10);
  assert.equal((await sara.get("/api/seance?classId=1re-annee&date=" + date)).status, 403);
  assert.equal((await sara.post("/api/seance/summary", { classId: "1re-annee", date })).status, 403);
  assert.equal((await prof.get("/api/seance?classId=1re-annee&date=../../x")).status, 400);
  const info = (await prof.get("/api/seance?classId=1re-annee&date=" + date)).data;
  assert.equal(info.eleves, 1);
  assert.equal(info.summary, null);
  const r = await prof.post("/api/seance/summary", { classId: "1re-annee", date });
  assert.equal(r.status, 200);
  assert.match(r.data.summary.texte, new RegExp("Résumé pour classe : " + info.questions + " question"));
  assert.equal((await prof.get("/api/seance?classId=1re-annee&date=" + date)).data.summary.texte, r.data.summary.texte, "le résumé est gardé");
  assert.equal((await prof.post("/api/seance/summary", { classId: "1re-annee", date: "2001-01-01" })).status, 400, "jour sans questions");
});

/* ---------- Cache de contexte ---------- */
test("cache : un seul cache pour toutes les questions sur la même leçon", async () => {
  const avant = { ...mock.stats };
  const nora = client();
  await connecter(nora, "Nora Idrissi");
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

test("le nom de l'élève est enregistré comme du texte, sans être interprété", async () => {
  const x = client();
  const nom = "<img src=x onerror=alert(1)>";
  assert.equal((await connecter(x, nom)).status, 200);
  assert.equal((await x.get("/api/me")).data.student, nom);
  assert.match((await x.get("/api/me")).headers.get("content-type"), /application\/json/);
});

test("déconnexion : la session ne marche plus", async () => {
  const x = client();
  await connecter(x, "Adam Alaoui");
  assert.equal((await x.get("/api/me")).status, 200);
  await x.post("/api/logout");
  assert.equal((await x.get("/api/me")).status, 401);
});

test("compte supprimé ou classe supprimée : l'élève est déconnecté", async () => {
  const x = client();
  await connecter(x, "Nora Idrissi");
  assert.equal((await x.get("/api/me")).status, 200);
  assert.equal((await prof.del("/api/students?id=" + comptes["Nora Idrissi"].id)).status, 200);
  assert.equal((await x.get("/api/me")).status, 401);
  assert.equal((await connecter(client(), "Nora Idrissi")).status, 401);
  // suppression de la 2e classe : ses élèves ne peuvent plus entrer
  await connecter(x, "Adam Alaoui");
  const d = await prof.del("/api/classes?id=2e-annee");
  assert.equal(d.status, 200);
  assert.equal(d.data.comptesSupprimes, 2);
  assert.equal((await x.get("/api/me")).status, 401);
  assert.equal((await yassine.get("/api/me")).status, 401);
});
