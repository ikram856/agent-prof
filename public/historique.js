/*
 * historique.js — garde les conversations de chaque mode (cours / debat / quiz).
 *
 * - Sauvegarde instantanée dans le navigateur (localStorage) :
 *   rien ne se perd quand on change de mode, d'onglet, de fenêtre ou qu'on recharge la page.
 * - Copie de secours sur le serveur (dossier conversations/) :
 *   l'historique survit même si on vide le cache du navigateur.
 *
 * Utilisation dans index.html :
 *   <script src="/historique.js"></script>
 *   Historique.get("quiz")            -> tableau [{role, content}, ...]
 *   Historique.set("quiz", messages)  -> enregistre
 *   Historique.clear("quiz")          -> vide un mode (bouton « Nouvelle conversation »)
 *   Historique.state                  -> { mode, lessonId, extra } (derniers réglages choisis)
 *   Historique.setState({ mode: "debat" })
 *   Historique.ready.then(() => ...)  -> attendre la récupération depuis le serveur
 */
(function () {
  const CLE = "agent-prof-historique";
  const CLE_ID = "agent-prof-id";

  let id = null;
  try { id = localStorage.getItem(CLE_ID); } catch {}
  if (!id || !/^[a-z0-9-]{8,64}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)).toLowerCase();
    try { localStorage.setItem(CLE_ID, id); } catch {}
  }

  const vide = () => ({ conversations: { cours: [], debat: [], quiz: [] }, state: {}, updatedAt: 0 });

  let data = vide();
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || "null");
    if (brut && brut.conversations) data = Object.assign(vide(), brut);
  } catch {}

  function enregistrerLocal() {
    data.updatedAt = Date.now();
    try { localStorage.setItem(CLE, JSON.stringify(data)); } catch {}
    planifierEnvoi();
  }

  let minuteur = null;
  function planifierEnvoi() {
    clearTimeout(minuteur);
    minuteur = setTimeout(envoyer, 1000);
  }
  function envoyer() {
    clearTimeout(minuteur);
    fetch("/api/conversations?id=" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true
    }).catch(() => {});
  }

  // Récupère la copie du serveur si elle est plus récente
  const ready = fetch("/api/conversations?id=" + id)
    .then(r => r.json())
    .then(({ data: serveur }) => {
      if (serveur && serveur.conversations && (serveur.updatedAt || 0) > data.updatedAt) {
        data = Object.assign(vide(), serveur);
        try { localStorage.setItem(CLE, JSON.stringify(data)); } catch {}
      }
    })
    .catch(() => {});

  // Synchronise si la page est ouverte dans deux onglets
  window.addEventListener("storage", e => {
    if (e.key !== CLE || !e.newValue) return;
    try {
      data = Object.assign(vide(), JSON.parse(e.newValue));
      window.dispatchEvent(new CustomEvent("historique-change"));
    } catch {}
  });

  // Envoie au serveur quand on quitte ou cache la page
  document.addEventListener("visibilitychange", () => { if (document.hidden) envoyer(); });
  window.addEventListener("pagehide", envoyer);

  // role + content (envoyés à l'IA), shown (texte affiché) et t (heure) facultatifs
  const propre = m => {
    const o = { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) };
    if (m.shown != null) o.shown = String(m.shown);
    if (m.t) o.t = String(m.t);
    return o;
  };

  window.Historique = {
    ready,
    get(mode) { return (data.conversations[mode] || []).map(m => Object.assign({}, m)); },
    set(mode, messages) {
      data.conversations[mode] = (messages || []).map(propre);
      enregistrerLocal();
    },
    add(mode, message) {
      (data.conversations[mode] = data.conversations[mode] || []).push(propre(message));
      enregistrerLocal();
    },
    clear(mode) {
      if (mode) data.conversations[mode] = [];
      else data.conversations = vide().conversations;
      enregistrerLocal();
    },
    get state() { return Object.assign({}, data.state); },
    setState(partiel) { data.state = Object.assign({}, data.state, partiel); enregistrerLocal(); }
  };
})();
