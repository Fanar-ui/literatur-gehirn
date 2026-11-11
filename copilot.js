// Copilot fürs Literatur-Gehirn: schwebt frei verschiebbar über dem Canvas
// (wie der Copilot im EcoGovernance-Builder). Agent + Sprechblase + Eingabe.
// Papers und Unterthemen werden per @ als Etiketten eingefügt; nur diese gehen
// als Kontext an den Baum. Texte nur über textContent (nie als HTML).
const Copilot = (() => {
  const POS_KEY = "literatur-gehirn-copilot-pos";
  const MAX_FULLTEXT = 3;     // höchstens so viele Papers im Volltext durchsuchen
  let getState = () => ({ papers: [], subtopics: [] });
  let onFootprint = () => {};
  let onSaveNote = () => {};
  let refs = [];              // [{type: "paper"|"subtopic", id, label}]
  const history = [];         // [{q, a}]
  let root, mascot, bubble, chipsBox, input, menu, histBox, busy = false;

  const elx = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Einfaches Markdown (**fett**, Aufzählungen) als DOM, ohne innerHTML
  function inline(parent, line) {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(elx("strong", null, part.slice(2, -2)));
      else if (part) parent.append(document.createTextNode(part));
    }
  }
  function renderText(container, text) {
    const box = elx("div", "cp-md");
    let list = null;
    for (const raw of String(text).split("\n")) {
      const line = raw.trimEnd();
      const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) {
        if (!list) { list = elx("ul"); box.append(list); }
        const li = elx("li"); inline(li, m[1]); list.append(li);
      } else {
        list = null;
        if (!line.trim()) continue;
        const p = elx("p"); inline(p, line.replace(/^#+\s*/, "")); box.append(p);
      }
    }
    container.append(box);
  }

  function say(text, state = "talking", footer = "", actions = null) {
    bubble.replaceChildren();
    renderText(bubble, text);
    if (actions) bubble.append(actions);
    if (footer) bubble.append(elx("div", "cp-foot", footer));
    AgentMascot.setState(mascot, state);
    if (state === "talking") setTimeout(() => { if (!busy) AgentMascot.setState(mascot, "idle"); }, 2500);
  }

  // ── Etiketten ────────────────────────────────────────────────────────────
  function addRef(type, id) {
    const st = getState();
    if (refs.some((r) => r.type === type && r.id === id)) return;
    if (type === "survey") {
      refs.push({ type: "survey", id: "umfrage", label: "Umfrage" });
      renderChips();
      input.focus();
      return;
    }
    const item = type === "paper" ? st.papers.find((p) => p.id === id) : st.subtopics.find((u) => u.id === id);
    if (!item) return;
    refs.push({ type, id, label: type === "paper" ? item.title : item.name });
    renderChips();
    input.focus();
  }
  function renderChips() {
    chipsBox.replaceChildren();
    for (const r of refs) {
      const chip = elx("span", "cp-chip " + r.type, (r.type === "subtopic" ? "# " : r.type === "survey" ? "📊 " : "@ ") + (r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label));
      chip.title = r.label;
      const x = elx("button", "cp-chip-x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Entfernen");
      x.addEventListener("click", () => { refs = refs.filter((y) => y !== r); renderChips(); });
      chip.append(x);
      chipsBox.append(chip);
    }
    chipsBox.hidden = !refs.length;
  }

  // ── @-Menü ───────────────────────────────────────────────────────────────
  function mentionQuery() {
    const before = input.value.slice(0, input.selectionStart);
    const m = before.match(/@([^@\n]*)$/);
    return m ? m[1].toLowerCase() : null;
  }
  function updateMenu() {
    const q = mentionQuery();
    if (q === null) { menu.hidden = true; return; }
    const st = getState();
    const items = [
      { type: "survey", id: "umfrage", label: "Umfrage" },
      ...st.subtopics.map((u) => ({ type: "subtopic", id: u.id, label: u.name })),
      ...st.papers.map((p) => ({ type: "paper", id: p.id, label: p.title })),
    ].filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8);
    menu.replaceChildren();
    if (!items.length) { menu.append(elx("div", "cp-menu-empty", "Nichts gefunden")); }
    for (const it of items) {
      const b = elx("button", "cp-menu-item");
      b.type = "button";
      b.append(elx("span", "cp-menu-kind", it.type === "survey" ? "Daten" : it.type === "subtopic" ? "Unterthema" : "Paper"), elx("span", null, it.type === "survey" ? "Umfrage (Analyse-Agent)" : it.label));
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = input.selectionStart;
        const before = input.value.slice(0, pos).replace(/@([^@\n]*)$/, "");
        input.value = before + input.value.slice(pos);
        input.setSelectionRange(before.length, before.length);
        menu.hidden = true;
        addRef(it.type, it.id);
      });
      menu.append(b);
    }
    menu.hidden = false;
  }

  // ── Welche Papers sind gemeint? ──────────────────────────────────────────
  function scopePapers() {
    const st = getState();
    const lit = refs.filter((r) => r.type !== "survey");
    if (!lit.length) return { papers: st.papers, explicit: false };
    const ids = new Set();
    for (const r of lit) {
      if (r.type === "paper") ids.add(r.id);
      else st.papers.filter((p) => p.subtopic === r.id).forEach((p) => ids.add(p.id));
    }
    return { papers: st.papers.filter((p) => ids.has(p.id)).sort((a, b) => (a.ring || 2) - (b.ring || 2)), explicit: true };
  }
  function shortName(p) {
    const first = String(p.authors || "").split(/,| u\. a\./)[0].trim();
    const last = first.split(" ").pop() || "o. A.";
    return `${last} ${p.year || ""}`.trim();
  }
  function passagesBlock(p) {
    const ps = p.passages || [];
    if (!ps.length) return "";
    return "Passagen der Studentin:\n" + ps.map((x) =>
      `- [${x.used ? "in der Arbeit benutzt" : "gesammelt, nicht benutzt"}${x.page ? ", S. " + x.page : ""}] "${x.text}"${x.comment ? " (Kommentar: " + x.comment + ")" : ""}`
    ).join("\n");
  }
  function summaryBlock(p) {
    return [`[${shortName(p)}] ${p.title}`, `Zusammenfassung: ${p.summary || "keine"}`, p.notes ? `Notizen der Studentin: ${p.notes}` : "", passagesBlock(p)].filter(Boolean).join("\n");
  }
  function parseTerms(text) {
    try {
      const j = JSON.parse(String(text || "").replace(/^```(json)?/i, "").replace(/```$/, "").trim());
      return Array.isArray(j.terms) ? j.terms.map(String).slice(0, 8) : [];
    } catch { return []; }
  }
  // Kompakte Landkarte der Mindmap (wenige hundert Tokens auch bei vielen Papers)
  function buildMap() {
    const st = getState();
    const RING = { 1: "Kreis 1 (zentral)", 2: "Kreis 2 (relevant)", 3: "Kreis 3 (am Rand)" };
    const byId = Object.fromEntries(st.papers.map((p) => [p.id, p]));
    const line = (p) => `    ${RING[p.ring] || "Kreis 2 (relevant)"}: ${shortName(p)}, ${p.title.length > 80 ? p.title.slice(0, 79) + "…" : p.title}`;
    const out = [`Hauptthema: ${st.topicTitle || ""}${st.topic ? " (" + st.topic + ")" : ""}`];
    const known = new Set((st.subtopics || []).map((u) => u.id));
    for (const u of st.subtopics || []) {
      const ps = st.papers.filter((p) => p.subtopic === u.id).sort((a, b) => (a.ring || 2) - (b.ring || 2));
      out.push(`Unterthema „${u.name}“ (${ps.length} Paper${ps.length === 1 ? "" : "s"})${u.description ? ": " + u.description : ""}`);
      ps.forEach((p) => out.push(line(p)));
    }
    const rest = st.papers.filter((p) => !known.has(p.subtopic));
    if (rest.length) { out.push(`Noch nicht zugeordnet (${rest.length})`); rest.forEach((p) => out.push(line(p))); }
    const cites = (st.links || []).filter((l) => l.type === "cites" && byId[l.from] && byId[l.to]);
    if (cites.length) out.push("Zitate laut OpenAlex: " + cites.map((l) => `${shortName(byId[l.from])} zitiert ${shortName(byId[l.to])}`).join("; "));
    const themes = (st.links || []).filter((l) => l.type === "theme" && byId[l.from] && byId[l.to]);
    if (themes.length) out.push("Thematisch nah: " + themes.map((l) => `${shortName(byId[l.from])} und ${shortName(byId[l.to])}`).join("; "));
    return out.join("\n");
  }

  const content = (res) => (res && res.node_response && res.node_response["choices.0.message.content"]) || "";
  const energy = (res) => (res && res.footprint && res.footprint.energy_kwh) || 0;
  const carbon = (res) => (res && res.footprint && res.footprint.carbon_kg) || 0;

  async function send() {
    let q = input.value.trim();
    if (!q || busy) return;
    // @umfrage auch als getippter Text erkennen
    if (/(^|\s)@umfrage\b/i.test(q)) {
      q = q.replace(/(^|\s)@umfrage\b/gi, " ").trim();
      addRef("survey", "umfrage");
      input.value = q;
    }
    if (refs.some((r) => r.type === "survey")) return sendSurvey(q);
    busy = true;
    AgentMascot.setState(mascot, "thinking");
    const step = (t) => { bubble.replaceChildren(document.createTextNode(t)); };
    const st = getState();
    const { papers, explicit } = scopePapers();
    const calls = [];
    const usedRefs = refs.map((r) => r.label);
    try {
      if (!papers.length) throw new Error("Im Gehirn ist noch keine Literatur.");
      let context = "", found = 0, route = "";

      // Volltext nur für ausdrücklich eingefügte Papers (höchstens drei)
      const full = explicit ? papers.slice(0, MAX_FULLTEXT) : [];
      let items = [];
      if (full.length) {
        step("Ich übersetze deine Frage in Suchbegriffe …");
        const tRes = await Api.askTree({ mode: "terms", query: "Modus: Suchbegriffe", question: q, scope: full.map((p) => "- " + p.title).join("\n") });
        calls.push(tRes);
        const terms = parseTerms(content(tRes));
        step(`Suche nach: ${terms.join(", ") || "(keine Begriffe)"} …`);
        for (const p of full) {
          try {
            const secs = await Fulltext.sectionsFor(p.id);
            items.push(...secs.map((s) => ({ ...s, paper: p })));
          } catch { /* kein Volltext: dann nur Zusammenfassung */ }
        }
        const hits = terms.length ? Fulltext.search(items, terms, 5) : [];
        found = hits.length;
        context = hits.map((h) => `[${shortName(h.paper)}, ${h.head}] ${h.text}`).join("\n\n");
        route = `Suchbegriffe: ${terms.join(", ")}`;
        step(`${found} passende Abschnitt${found === 1 ? "" : "e"} gefunden, ich formuliere die Antwort …`);
      }
      // Zusammenfassungen und Notizen kommen immer dazu
      context = [context, papers.map(summaryBlock).join("\n\n")].filter(Boolean).join("\n\n---\n\n");

      const aRes = await Api.askTree({ mode: "answer", query: "Modus: Antwort", question: q, context, map: buildMap() });
      calls.push(aRes);
      const answer = content(aRes) || "Darauf habe ich keine Antwort bekommen.";

      const wh = calls.reduce((a, r) => a + energy(r), 0);
      const g = calls.reduce((a, r) => a + carbon(r), 0);
      onFootprint({ energy_kwh: wh, carbon_kg: g }, q);
      const footer = [
        full.length ? `Weg: Suchbegriffe (gpt-oss) → Wortsuche ohne KI → Antwort (Mistral)` : `Weg: Antwort (Mistral) aus Zusammenfassungen`,
        full.length ? `${found} Abschnitt${found === 1 ? "" : "e"} aus ${full.length} Volltext${full.length === 1 ? "" : "en"}` : `${papers.length} Zusammenfassung${papers.length === 1 ? "" : "en"}`,
        `${(wh * 1000).toFixed(2)} Wh · ${(g * 1000).toFixed(2)} g CO₂`,
      ].join(" · ");

      history.push({ q, refs: usedRefs, a: answer, footer, route });
      input.value = "";
      refs = []; renderChips();
      renderHistory();
      busy = false;
      say(answer, "talking", footer, answerActions(q, answer, explicit ? papers.slice(0, 3) : []));
    } catch (e) {
      busy = false;
      say(`Das hat nicht geklappt: ${e.message}`, "error");
    }
  }

  // ── Umfrage: Analyse-Agent im Baum (Freigabe in der Sprechblase) ─────────
  const surveyExtra = (permission) => ({
    node_response_fields: ["choices.0.message.content"],
    include_tool_results: true,
    ...(permission ? { permission } : {}),
  });

  async function sendSurvey(q) {
    if (!q) { say("Was möchtest du zur Umfrage wissen?", "idle"); return; }
    busy = true;
    AgentMascot.setState(mascot, "thinking");
    bubble.replaceChildren(document.createTextNode("Ich frage den Baum …"));
    const payload = { mode: "analyse", query: q };
    try {
      const res = await Api.askTree(payload, surveyExtra());
      if (res.status === "permission_required") return askPermission(q, payload, res.permission);
      finishSurvey(q, res);
    } catch (e) {
      busy = false;
      say(`Das hat nicht geklappt: ${e.message}`, "error");
    }
  }

  function askPermission(q, payload, perm) {
    bubble.replaceChildren();
    renderText(bubble, perm.question);
    const box = elx("div", "cp-actions");
    const yes = elx("button", "cp-small", "Ja");
    const no = elx("button", "ghost cp-small", "Nein");
    yes.type = no.type = "button";
    const go = async (allowed) => {
      yes.disabled = no.disabled = true;
      let secs = 0;
      const tick = () => bubble.replaceChildren(document.createTextNode(`Der Analyse-Agent rechnet … ${secs} s`));
      AgentMascot.setState(mascot, "thinking");
      if (allowed) tick();
      const timer = allowed ? setInterval(() => { secs++; tick(); }, 1000) : null;
      try {
        const res = await Api.askTree(payload, surveyExtra({ token: perm.token, decision: allowed ? "allowed" : "denied" }));
        finishSurvey(q, res);
      } catch (e) {
        busy = false;
        say(`Das hat nicht geklappt: ${e.message}`, "error");
      } finally {
        if (timer) clearInterval(timer);
      }
    };
    yes.addEventListener("click", () => go(true));
    no.addEventListener("click", () => go(false));
    box.append(yes, no);
    bubble.append(box);
    AgentMascot.setState(mascot, "idle");
  }

  function stepsList(agent) {
    const det = elx("details", "cp-steps");
    det.append(elx("summary", null, `Schritte des Agenten (${(agent.tool_calls || []).length})`));
    const ol = elx("ol");
    for (const tc of agent.tool_calls || []) {
      const li = elx("li");
      const args = tc.args && Object.keys(tc.args).length
        ? "(" + Object.entries(tc.args).map(([k, v]) => `${k}=${v}`).join(", ") + ")" : "()";
      li.append(elx("code", null, tc.name + args));
      let r = tc.result;
      if (typeof r === "string") { try { r = JSON.parse(r); } catch { /* Text */ } }
      if (tc.error) li.append(elx("span", "cp-step-err", tc.error));
      else if (r && r.fehler) li.append(elx("span", "cp-step-err", r.fehler));
      else if (r && r.apa) li.append(elx("span", "cp-step-apa", `${r.test ? r.test + ": " : ""}${r.apa}`));
      else if (r && r.variablen) li.append(elx("span", null, `${r.variablen.length} Variablen, ${r.n_antworten} Antworten`));
      ol.append(li);
    }
    det.append(ol);
    return det;
  }

  function finishSurvey(q, res) {
    busy = false;
    const text = content(res) || (res.node_response && res.node_response.text) || "Darauf habe ich keine Antwort bekommen.";
    if (!res.agent) {                       // "Nein" oder kein Agent
      refs = []; renderChips(); input.value = "";
      say(text, "idle");
      return;
    }
    const wh = energy(res), g = carbon(res);
    onFootprint({ energy_kwh: wh, carbon_kg: g }, "Umfrage: " + q);
    const secs = res.performance && res.performance.total_latency_ms ? (res.performance.total_latency_ms / 1000).toFixed(0) + " s" : "";
    const footer = [
      `Weg: Analyse-Agent (${res.model || "DeepSeek"}) → ${(res.agent.tool_calls || []).length} Werkzeugaufrufe auf deinem Laptop`,
      `${res.agent.rounds} Modellrunden`, secs,
      `${(wh * 1000).toFixed(2)} Wh · ${(g * 1000).toFixed(2)} g CO₂`,
    ].filter(Boolean).join(" · ");
    history.push({ q, refs: ["Umfrage"], a: text, footer, route: "Umfrage" });
    input.value = "";
    refs = []; renderChips();
    renderHistory();
    const actions = answerActions(q, text, []);
    actions.prepend(stepsList(res.agent));
    say(text, "talking", footer, actions);
  }

  // Kopieren + "Soll ich das als Notiz speichern?"
  function answerActions(q, answer, candidates) {
    const box = elx("div", "cp-actions");
    const copy = elx("button", "ghost cp-small", "Kopieren");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(answer); copy.textContent = "Kopiert"; }
      catch { copy.textContent = "Kopieren nicht möglich"; }
      setTimeout(() => { copy.textContent = "Kopieren"; }, 1800);
    });
    box.append(copy);
    if (candidates.length) {
      box.append(elx("div", "cp-ask", candidates.length === 1 ? "Soll ich das als Notiz an diesem Paper speichern?" : "Soll ich das als Notiz speichern? An welchem Paper?"));
      for (const p of candidates) {
        const b = elx("button", "cp-small cp-note-btn", candidates.length === 1 ? "Ja, als Notiz speichern" : (p.title.length > 40 ? p.title.slice(0, 39) + "…" : p.title));
        b.type = "button";
        b.title = p.title;
        b.addEventListener("click", () => {
          onSaveNote(p.id, q, answer);
          b.disabled = true;
          b.textContent = "Gespeichert";
        });
        box.append(b);
      }
    }
    return box;
  }

  function renderHistory() {
    histBox.replaceChildren();
    for (const h of history.slice().reverse()) {
      const item = elx("div", "cp-hist-item");
      item.append(elx("div", "cp-hist-q", h.q + (h.refs.length ? `  [${h.refs.join(", ")}]` : "")));
      const a = elx("div", "cp-hist-a"); renderText(a, h.a); item.append(a);
      if (h.footer) item.append(elx("div", "cp-foot", h.footer));
      histBox.append(item);
    }
  }

  // ── Verschieben (ganze Gruppe greifbar, außer Buttons/Eingaben) ──────────
  function makeDraggable(container) {
    let drag = null;
    const clamp = (x, y) => ({
      x: Math.min(Math.max(0, x), Math.max(0, container.clientWidth - root.offsetWidth)),
      y: Math.min(Math.max(0, y), Math.max(0, container.clientHeight - root.offsetHeight)),
    });
    const place = (p) => { root.style.left = p.x + "px"; root.style.top = p.y + "px"; };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch { saved = null; }
    requestAnimationFrame(() => place(clamp(saved ? saved.x : container.clientWidth - root.offsetWidth - 16, saved ? saved.y : 16)));
    root.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, input, textarea, .cp-menu, .cp-hist, .cp-bubble")) return;
      drag = { dx: e.clientX - root.offsetLeft, dy: e.clientY - root.offsetTop };
      root.setPointerCapture(e.pointerId);
      root.classList.add("dragging");
    });
    root.addEventListener("pointermove", (e) => { if (drag) place(clamp(e.clientX - drag.dx, e.clientY - drag.dy)); });
    const end = () => {
      if (!drag) return;
      drag = null;
      root.classList.remove("dragging");
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: root.offsetLeft, y: root.offsetTop })); } catch { /* egal */ }
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    window.addEventListener("resize", () => place(clamp(root.offsetLeft, root.offsetTop)));
  }

  function init(container, stateGetter, footprintCallback, noteCallback) {
    getState = stateGetter;
    if (footprintCallback) onFootprint = footprintCallback;
    if (noteCallback) onSaveNote = noteCallback;
    root = elx("div", "copilot");
    const head = elx("div", "cp-head");
    mascot = AgentMascot.create(64);
    bubble = elx("div", "cp-bubble", "Hallo! Frag mich etwas zu deinen Papers. Mit @ fügst du Papers oder Unterthemen ein, mit @Umfrage fragst du den Analyse-Agenten.");
    head.append(mascot, bubble);

    const box = elx("div", "cp-box");
    chipsBox = elx("div", "cp-chips"); chipsBox.hidden = true;
    input = elx("textarea", "cp-input");
    input.rows = 2;
    input.placeholder = "Frage stellen … (@ für Papers, Unterthemen oder Umfrage)";
    input.addEventListener("input", updateMenu);
    input.addEventListener("click", updateMenu);
    input.addEventListener("blur", () => setTimeout(() => { menu.hidden = true; }, 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (menu.hidden) send(); }
      if (e.key === "Escape") menu.hidden = true;
    });
    menu = elx("div", "cp-menu"); menu.hidden = true;
    const row = elx("div", "cp-row");
    const histBtn = elx("button", "ghost cp-small", "Verlauf");
    histBtn.type = "button";
    const sendBtn = elx("button", "cp-small", "Senden");
    sendBtn.type = "button";
    sendBtn.addEventListener("click", send);
    row.append(histBtn, sendBtn);
    histBox = elx("div", "cp-hist"); histBox.hidden = true;
    histBtn.addEventListener("click", () => { histBox.hidden = !histBox.hidden; histBtn.textContent = histBox.hidden ? "Verlauf" : "Verlauf ausblenden"; });
    box.append(chipsBox, input, menu, row, histBox);

    root.append(head, box);
    container.append(root);
    makeDraggable(container);
  }

  return { init, addRef };
})();
