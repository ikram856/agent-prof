/* Code commun à toutes les pages de MEHDI 2.0 */
(function () {
  const M = window.MEHDI = {};
  const $ = M.$ = id => document.getElementById(id);

  /* Appel à l'API du serveur. Redirige vers la connexion si la session a expiré. */
  M.api = async function (url, { method = "GET", body, headers = {}, noRedirect } = {}) {
    const isJSON = body !== undefined && !(body instanceof Blob) && typeof body !== "string";
    const r = await fetch(url, {
      method, body: isJSON ? JSON.stringify(body) : body,
      headers: { ...(isJSON ? { "Content-Type": "application/json" } : {}), ...headers }
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !noRedirect) { location.href = "/login.html"; throw new Error(d.error || "Non connecté."); }
    if (!r.ok) throw new Error(d.error || "Erreur " + r.status);
    return d;
  };

  M.fmtDate = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " +
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };
  M.fmtTime = iso => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  M.MODES = { cours: "💬 Questions", debat: "⚖️ Débat", quiz: "📝 Quiz" };

  /* Icône d'un message : logo MEHDI 2.0 pour l'IA, chapeau pour l'élève, prof pour le prof */
  M.avatar = who => {
    const a = document.createElement("div");
    a.className = "av";
    if (who === "bot") { const i = new Image(); i.src = "/avatar.jpg"; i.alt = "MEHDI 2.0"; a.appendChild(i); }
    else a.textContent = who === "prof" ? "👨‍🏫" : "🎓";
    return a;
  };
  /* Une bulle de discussion. text = null affiche « l'IA réfléchit… » */
  M.bubble = (container, who, text, time) => {
    const m = document.createElement("div");
    m.className = "msg " + (who === "bot" ? "bot" : "me");
    const w = document.createElement("div");
    const b = document.createElement("div"); b.className = "bub";
    if (text == null) b.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    else b.textContent = text;
    const t = document.createElement("div"); t.className = "time"; t.textContent = time || "";
    w.append(b, t); m.append(M.avatar(who), w); container.appendChild(m);
    return b;
  };

  /* En-tête commun + vérification de la connexion */
  M.init = async function (page, { profOnly } = {}) {
    let me;
    try { me = await M.api("/api/me"); } catch { return new Promise(() => {}); }
    if (profOnly && me.role !== "prof") { location.href = "/"; return new Promise(() => {}); }
    M.me = me;
    const top = $("top");
    top.innerHTML = "";
    const hin = document.createElement("div"); hin.className = "hin";
    const logo = new Image(); logo.className = "logo"; logo.src = "/logo.png"; logo.alt = "MEHDI 2.0";
    const ht = document.createElement("div"); ht.className = "ht"; ht.id = "sub";
    ht.textContent = [me.profile.nom, me.profile.matiere].filter(Boolean).join(" · ") || "MEHDI 2.0";
    const nav = document.createElement("nav");
    const links = [["seance", "/", "💬 Séance"], ["historique", "/historique.html", "🕘 Historique"], ["resumes", "/resumes.html", "📄 Résumés"]];
    if (me.role === "prof") links.push(["prof", "/prof.html", "⚙️ Espace prof"]);
    for (const [k, href, label] of links) {
      const a = document.createElement("a"); a.href = href; a.textContent = label;
      if (k === page) a.className = "on";
      nav.appendChild(a);
    }
    const who = document.createElement("span"); who.className = "who";
    who.textContent = me.role === "prof" ? "👨‍🏫 Professeur" : "🎓 " + me.student + " · " + me.className;
    const extra = document.createElement("span"); extra.id = "topx";
    const out = document.createElement("button"); out.className = "hb light"; out.textContent = "Déconnexion";
    out.onclick = async () => { await M.api("/api/logout", { method: "POST", noRedirect: true }).catch(() => {}); location.href = "/login.html"; };
    hin.append(logo, ht, nav, who, extra, out);
    top.appendChild(hin);
    return me;
  };

  /* ---------- Carte mentale ----------
     Texte attendu :
       Titre du cours
       - Idée principale
         - détail
  */
  M.parseCarte = text => {
    const lines = String(text || "").replace(/\t/g, "  ").split("\n").filter(l => l.trim());
    const tree = { title: "", branches: [] };
    for (const raw of lines) {
      const indent = raw.match(/^\s*/)[0].length;
      const bullet = /^\s*[-•*–]\s*/.test(raw);
      const t = raw.replace(/^\s*[-•*–]?\s*/, "").trim();
      if (!t) continue;
      if (!tree.title && !bullet) { tree.title = t; continue; }
      if (indent >= 2 && tree.branches.length) tree.branches[tree.branches.length - 1].kids.push(t);
      else tree.branches.push({ t, kids: [] });
    }
    if (!tree.title) tree.title = "Cours";
    return tree;
  };

  const wrap = (s, max) => {
    const words = String(s).split(/\s+/), out = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    return out.slice(0, 5);
  };
  const COLORS = ["#1d6cb3", "#1f8a4c", "#c2410c", "#7c3aed", "#0e7490", "#b91c1c"];
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  function box(g, cx, cy, w, lines, { fill, stroke, color, bold, size = 14, radius = 10 }) {
    const lh = size + 4, h = lines.length * lh + 14;
    el("rect", { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: radius, fill, stroke: stroke || fill, "stroke-width": 2 }, g);
    const t = el("text", { x: cx, y: cy - h / 2 + 7 + size, "text-anchor": "middle", fill: color, "font-size": size, "font-weight": bold ? 700 : 400 }, g);
    lines.forEach((l, i) => { const s = el("tspan", { x: cx, dy: i ? lh : 0 }, t); s.textContent = l; });
    return h;
  }

  /* Dessine la carte mentale dans un <svg> */
  M.drawCarte = (svg, text) => {
    const tree = typeof text === "string" ? M.parseCarte(text) : text;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 900, CX = 450, BW = 150, KW = 150, BX = 190, KX = 372;
    const lh = n => n * 19 + 14;
    // On répartit les idées principales à droite puis à gauche
    const sides = [[], []];
    tree.branches.forEach((b, i) => sides[i < Math.ceil(tree.branches.length / 2) ? 0 : 1].push({ ...b, color: COLORS[i % COLORS.length] }));
    const blocks = sides.map(list => list.map(b => {
      const bl = wrap(b.t, 16), kl = b.kids.map(k => wrap(k, 18));
      const kh = kl.reduce((s, l) => s + lh(l.length), 0) + Math.max(0, kl.length - 1) * 8;
      return { ...b, bl, kl, h: Math.max(lh(bl.length), kh) };
    }));
    const sideH = blocks.map(bs => bs.reduce((s, b) => s + b.h, 0) + Math.max(0, bs.length - 1) * 26);
    const titleLines = wrap(tree.title, 16);
    const H = Math.max(...sideH, lh(titleLines.length) + 20, 120) + 40;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "carte");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Carte mentale : " + tree.title);
    const links = el("g", { fill: "none", "stroke-width": 3 }, svg);
    const nodes = el("g", {}, svg);
    const CY = H / 2;

    blocks.forEach((bs, side) => {
      const dir = side === 0 ? 1 : -1;
      let y = CY - sideH[side] / 2;
      for (const b of bs) {
        const by = y + b.h / 2, bx = CX + dir * BX;
        el("path", { d: `M${CX + dir * 80},${CY} C${CX + dir * 120},${CY} ${bx - dir * 90},${by} ${bx - dir * BW / 2},${by}`, stroke: b.color, opacity: .75 }, links);
        box(nodes, bx, by, BW, b.bl, { fill: b.color, color: "#fff", bold: true, size: 15 });
        const kh = b.kl.reduce((s, l) => s + lh(l.length), 0) + Math.max(0, b.kl.length - 1) * 8;
        let ky = by - kh / 2;
        for (const kl of b.kl) {
          const h = lh(kl.length), kyc = ky + h / 2, kx = CX + dir * KX;
          el("path", { d: `M${bx + dir * BW / 2},${by} C${bx + dir * 105},${by} ${kx - dir * 105},${kyc} ${kx - dir * KW / 2},${kyc}`, stroke: b.color, "stroke-width": 2, opacity: .6 }, links);
          box(nodes, kx, kyc, KW, kl, { fill: "#f8fafc", stroke: b.color, color: "#11233d", size: 14 });
          ky += h + 8;
        }
        y += b.h + 26;
      }
    });
    box(nodes, CX, CY, 160, titleLines, { fill: "#11233d", color: "#fff", bold: true, size: 17, radius: 16 });
    return tree;
  };
})();
