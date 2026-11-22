const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;

async function essai(nom, url, body) {
  console.log("--- " + nom);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const txt = await r.text();
    console.log("Statut :", r.status, "en", Date.now() - t0, "ms");
    console.log(txt.slice(0, 600));
  } catch (e) {
    console.log("Echec :", e.name, e.message, e.cause?.code || "");
  }
}

await essai(
  "Methode 1 : generateContent",
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  { contents: [{ parts: [{ text: "Dis bonjour en une phrase." }] }] }
);

await essai(
  "Methode 2 : interactions",
  "https://generativelanguage.googleapis.com/v1beta/interactions",
  { model: model, input: "Dis bonjour en une phrase." }
);