/* Faux serveur Gemini pour les tests et le pipeline (aucune clé, aucun appel à Google).
   Répond en streaming (SSE) comme l'API streamGenerateContent.
   Utilisation seule : node test/mock-gemini.mjs 4001 */
import http from "node:http";
import { fileURLToPath } from "node:url";

function replyFor(body) {
  const last = body.contents?.at(-1)?.parts?.[0]?.text || "";
  if (/fiche de révision/.test(last))
    return "RÉSUMÉ:\nUn séisme est une vibration du sol.\n- Il naît au foyer.\n\nCARTE:\nLes séismes\n- Origine\n  - rupture des roches\n- Prévention\n  - normes parasismiques";
  if (/Début de séance/.test(last)) return "Question de débat : faut-il construire près des failles ? Es-tu POUR ou CONTRE ?";
  return "Réponse à : " + last.slice(0, 60);
}

export function startMock(port = 0) {
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    if (!req.url.includes(":streamGenerateContent")) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const part of replyFor(body).match(/.{1,16}/gs)) {
      res.write("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: part }] } }] }) + "\n\n");
      await new Promise(r => setTimeout(r, 5));
    }
    res.end();
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({
    url: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise(r => server.close(r))
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock(+process.argv[2] || 4001);
  console.log("Faux Gemini prêt :", m.url);
}
