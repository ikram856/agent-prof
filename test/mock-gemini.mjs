/* Faux serveur Gemini pour les tests et le pipeline (aucune clé, aucun appel à Google).
   Répond en streaming (SSE) comme l'API streamGenerateContent, et gère le cache de contexte
   (POST /v1beta/cachedContents) comme l'API réelle.
   Utilisation seule : node test/mock-gemini.mjs 4001 */
import http from "node:http";
import { fileURLToPath } from "node:url";

function replyFor(body) {
  const parts = body.contents?.at(-1)?.parts || [];
  const last = parts.find(p => p.text)?.text || "";
  const img = parts.find(p => p.inline_data);
  if (img) {   // photo : on « lit » le texte écrit dans l'image de test (après le marqueur TEXTE:)
    const brut = Buffer.from(img.inline_data.data, "base64").toString("latin1");
    const m = brut.match(/TEXTE:([^\0]*)/);
    return m ? "Transcription (" + img.inline_data.mime_type + ") : " + m[1].trim() + "\nSchéma : coupe de la Terre avec le foyer et l'épicentre." : "ILLISIBLE";
  }
  if (/fiche de révision/.test(last))
    return "RÉSUMÉ:\nUn séisme est une vibration du sol.\n- Il naît au foyer.\n\nCARTE:\nLes séismes\n- Origine\n  - rupture des roches\n- Prévention\n  - normes parasismiques";
  if (/RÉSUMÉ DE SÉANCE/.test(last)) {
    const sys = body.system_instruction?.parts?.[0]?.text || "";
    const qui = /CE QUE J'AI APPRIS/.test(sys) ? "élève" : /PARTICIPATION/.test(sys) ? "classe" : "prof";
    return "Résumé pour " + qui + " : " + (last.match(/^Élève : /gm) || []).length + " question(s) d'élève.";
  }
  if (/Début de séance/.test(last)) return "Question de débat : faut-il construire près des failles ? Es-tu POUR ou CONTRE ?";
  return "Réponse à : " + last.slice(0, 60);
}

export function startMock(port = 0) {
  const caches = new Map();   // nom -> texte des consignes
  const stats = { cachesCreated: 0, cachedRequests: 0, plainRequests: 0 };
  const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    // Création d'un cache
    if (req.method === "POST" && req.url.startsWith("/v1beta/cachedContents")) {
      if (/sanscache/.test(body.model || "")) return send(res, 400, { error: { message: "Caching is not supported for this model" } });
      const name = "cachedContents/test-" + (++stats.cachesCreated);
      caches.set(name, body.systemInstruction?.parts?.[0]?.text || "");
      return send(res, 200, { name, model: body.model, expireTime: new Date(Date.now() + 3600e3).toISOString() });
    }
    if (!req.url.includes(":streamGenerateContent")) { res.writeHead(404); return res.end(); }

    let systemText = body.system_instruction?.parts?.[0]?.text || "";
    if (body.cachedContent) {
      if (!caches.has(body.cachedContent)) return send(res, 404, { error: { message: "CachedContent not found (or expired)" } });
      if (body.system_instruction || body.systemInstruction) return send(res, 400, { error: { message: "system_instruction cannot be set with cachedContent" } });
      systemText = caches.get(body.cachedContent);
      stats.cachedRequests++;
    } else stats.plainRequests++;

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const parts = replyFor(body).match(/.{1,16}/gs);
    const systemTokens = Math.round(systemText.length / 4);
    for (let i = 0; i < parts.length; i++) {
      const chunk = { candidates: [{ content: { parts: [{ text: parts[i] }] } }] };
      if (i === parts.length - 1) chunk.usageMetadata = {
        promptTokenCount: systemTokens + 20,
        ...(body.cachedContent ? { cachedContentTokenCount: systemTokens } : {})
      };
      res.write("data: " + JSON.stringify(chunk) + "\n\n");
      await new Promise(r => setTimeout(r, 5));
    }
    res.end();
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({
    url: "http://127.0.0.1:" + server.address().port,
    stats,
    expireAll: () => caches.clear(),   // simule l'expiration des caches chez Google
    close: () => new Promise(r => server.close(r))
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock(+process.argv[2] || 4001);
  console.log("Faux Gemini prêt :", m.url);
}
