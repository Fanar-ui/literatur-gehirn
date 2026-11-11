// Literatur-Gehirn – Schritt 1: Suche, Hinzufügen, Rückfrage, Speichern, Liste.
// Alle Texte aus OpenAlex/Modell werden nur über textContent eingefügt (nie als HTML).

const STORAGE_KEY = "literatur-gehirn-v1";
const DEFAULT_TOPIC =
  "Die Masterarbeit untersucht, wie generative KI die Arbeit von Wissensarbeitenden verändert und welche Kompetenzen dadurch wichtiger werden.";
const DEFAULT_TOPIC_TITLE = "Generative KI in der Wissensarbeit";
const RING_LABEL = { 1: "zentral", 2: "relevant", 3: "am Rand" };

// ── Zustand ──────────────────────────────────────────────────────────────
let state = load();
let selectedWork = null;

function emptyState() {
  return { topic: DEFAULT_TOPIC, topicTitle: DEFAULT_TOPIC_TITLE, subtopics: [], papers: [], links: [], checks: [] };
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate({ ...emptyState(), ...JSON.parse(raw) }) : emptyState();
  } catch { return emptyState(); }
}
// ältere Gehirne (mit Cluster/Relevanz) auf Unterthemen + Kreise umstellen
function migrate(st) {
  for (const p of st.papers) {
    if (p.ring == null) {
      const r = Number(p.relevance) || 0.5;
      const lvl = r <= 1 ? r * 10 : r;
      p.ring = lvl >= 8 ? 1 : lvl >= 5 ? 2 : 3;
    }
    if (p.subtopic === undefined) p.subtopic = null;
    if (!Array.isArray(p.passages)) p.passages = [];
  }
  return st;
}
function subtopicName(id) {
  const u = (state.subtopics || []).find((x) => x.id === id);
  return u ? u.name : "Noch nicht zugeordnet";
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Speicher voll/gesperrt */ }
}

// ── Hilfen ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function setStatus(id, text, isError = false) {
  const s = $(id);
  s.textContent = text || "";
  s.classList.toggle("error", isError);
}
function shortId(id) { return String(id || "").replace("https://openalex.org/", ""); }
function cleanDoi(doi) { return String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""); }

// OpenAlex liefert Abstracts als Wortindex: {wort: [positionen]}
function abstractFromIndex(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(" ");
}

function pdfInfo(w) {
  const oa = w.best_oa_location || {};
  return {
    hasPdf: !!(w.has_content && w.has_content.pdf),
    oaPdfUrl: /^https:\/\//.test(oa.pdf_url || "") ? oa.pdf_url : "",
  };
}

function workInfo(w) {
  const authors = (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean);
  const authorText = authors.length > 2 ? `${authors[0]} u. a.` : authors.join(", ");
  const venue = w.primary_location && w.primary_location.source && w.primary_location.source.display_name;
  return {
    id: w.id,
    title: w.display_name || w.title || "(ohne Titel)",
    doi: cleanDoi(w.doi),
    year: w.publication_year || "",
    authors: authorText,
    venue: venue || "",
    abstract: abstractFromIndex(w.abstract_inverted_index),
    ...pdfInfo(w),
  };
}

// ── Suche (OpenAlex, ohne KI) ─────────────────────────────────────────────
async function search(q) {
  const select = "id,doi,display_name,publication_year,authorships,primary_location,abstract_inverted_index,has_content,best_oa_location";
  const doiMatch = q.match(/10\.\d{4,9}\/\S+/);
  const url = doiMatch
    ? `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doiMatch[0])}&per_page=3&select=${select}`
    : `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=3&select=${select}`;
  const data = await Api.openAlex(url);
  return (data.results || []).map(workInfo);
}

function renderResults(works) {
  const box = $("results");
  box.replaceChildren();
  if (!works.length) { box.append(el("div", "empty", "Keine Treffer. Versuch es mit einem anderen Titel.")); return; }
  for (const w of works) {
    const known = state.papers.some((p) => p.id === w.id);
    const card = el("div", "card" + (!w.doi || known ? " disabled" : ""));
    card.append(el("div", "title", w.title));
    const meta = [w.authors, w.year, w.venue].filter(Boolean).join(" · ");
    card.append(el("div", "meta", known ? "Schon im Gehirn" : !w.doi ? `${meta} · ohne DOI` : meta));
    if (w.doi && !known) card.addEventListener("click", () => select(w));
    box.append(card);
  }
}

function select(w) {
  selectedWork = w;
  $("results").replaceChildren();
  const box = $("selected-card");
  box.replaceChildren();
  const card = el("div", "card");
  card.append(el("div", "title", w.title));
  card.append(el("div", "meta", [w.authors, w.year, w.venue, w.doi].filter(Boolean).join(" · ")));
  box.append(card);
  $("abstract-input").value = "";
  $("abstract-box").hidden = !!w.abstract;
  setStatus("add-status", "");
  $("selected").hidden = false;
  $("btn-add").focus();
}

function resetSelection() {
  selectedWork = null;
  $("selected").hidden = true;
  $("search-input").value = "";
}

// ── Hinzufügen über den EcoGovernance-Baum ───────────────────────────────
function buildPayload(w, notes) {
  return {
    // query = Ankertext des Asts: Vektor-Routing trifft auch ohne Classifier den richtigen Ast
    mode: "add",
    query: "Modus: Hinzufügen",
    doi: w.doi,
    title: w.title,
    abstract: w.abstract,
    notes,
    topic: state.topic,
    existing_ids: state.papers.map((p) => p.id).join("|") || "W0",
    subtopics: state.subtopics.length
      ? state.subtopics.map((u) => `- ${u.id} | ${u.name} | ${u.description || ""}`).join("\n")
      : "(keine Unterthemen festgelegt)",
    brain: state.papers.length
      ? state.papers.map((p) => `- ${p.id} | ${p.title} | ${p.subtopic || "none"}`).join("\n")
      : "(noch leer)",
  };
}

function parseModelJson(text) {
  const cleaned = String(text || "").replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function footprintOf(res) {
  const f = res.footprint || {};
  return { energy_kwh: f.energy_kwh || 0, carbon_kg: f.carbon_kg || 0, water_l: f.water_l || 0 };
}

async function addPaper() {
  const w = selectedWork;
  if (!w) return;
  const notes = "";
  const typed = $("abstract-input").value.trim();
  if (!w.abstract && typed) w.abstract = typed;
  $("btn-add").disabled = true;
  setStatus("add-status", "Das Gehirn denkt nach … (OpenAlex, Zusammenfassung, Einordnung)");
  try {
    const res = await Api.askTree(buildPayload(w, notes));


    const content = res.node_response && res.node_response["choices.0.message.content"];
    const out = parseModelJson(content);
    const known = new Set([w.id, ...state.papers.map((p) => p.id)]);
    const paper = {
      ...w,
      notes,
      summary: (out.paper && out.paper.summary) || "",
      subtopic: state.subtopics.some((u) => u.id === (out.paper && out.paper.subtopic)) ? out.paper.subtopic : null,
      ring: [1, 2, 3].includes(Number(out.paper && out.paper.ring)) ? Number(out.paper.ring) : 2,
      footprint: footprintOf(res),
      added: new Date().toISOString(),
    };
    const links = (out.links || [])
      .filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to)
      .filter((l) => (l.from === w.id || l.to === w.id))
      .map((l) => ({ from: l.from, to: l.to, type: l.type === "cites" ? "cites" : "theme", reason: l.reason || "" }));

    state.papers.push(paper);
    state.links.push(...links);
    state.checks.push({ title: w.title, result: "aufgenommen", at: paper.added, footprint: paper.footprint });
    save();
    resetSelection();
    renderSubtopics();
    render();
  } catch (e) {
    setStatus("add-status", `Das hat nicht geklappt: ${e.message}`, true);
  } finally {
    $("btn-add").disabled = false;
  }
}

// ── Anzeige ──────────────────────────────────────────────────────────────
function renderFootprint() {
  const sum = state.checks.reduce((a, c) => {
    a.energy += (c.footprint && c.footprint.energy_kwh) || 0;
    a.carbon += (c.footprint && c.footprint.carbon_kg) || 0;
    return a;
  }, { energy: 0, carbon: 0 });
  const box = $("footprint");
  box.replaceChildren();
  box.append(
    el("span", null, `${state.papers.length} Papers · `),
    el("b", null, `${(sum.energy * 1000).toFixed(2)} Wh`),
    el("span", null, " · "),
    el("b", null, `${(sum.carbon * 1000).toFixed(2)} g CO₂`)
  );
}

function deletePaper(id) {
  const p = state.papers.find((x) => x.id === id);
  if (!p) return false;
  if (!confirm(`„${p.title}“ aus dem Gehirn löschen? Seine Verbindungen werden ebenfalls entfernt.`)) return false;
  state.papers = state.papers.filter((x) => x.id !== id);
  state.links = state.links.filter((l) => l.from !== id && l.to !== id);
  // Der Footprint bleibt in der Summe: die Rechenleistung wurde ja tatsächlich verbraucht.
  save();
  renderSubtopics();
  render();
  return true;
}

// Pop-up für einen der drei kleinen Punkte: "summary", "notes" oder "info"
function openPaper(id, view = "info") {
  const p = state.papers.find((x) => x.id === id);
  if (!p) return;
  const body = $("paper-body");
  body.replaceChildren();
  body.append(el("h3", "pd-title", p.title));
  body.append(el("div", "meta", [p.authors, p.year, p.venue].filter(Boolean).join(" · ")));

  if (view === "summary") {
    body.append(el("h4", null, "Zusammenfassung"));
    body.append(el("p", null, p.summary || "Noch keine Zusammenfassung."));
    if (!p.abstract) body.append(el("p", "pd-pdf-hint", "Hinweis: Für dieses Paper lag kein Abstract vor. Unterthema und Kreis beruhen nur auf dem Titel."));
  } else if (view === "notes") {
    body.append(el("h4", null, "Deine Notizen"));
    const ta = el("textarea", "pd-notes-edit");
    ta.rows = 8;
    ta.placeholder = "Wofür nutzt du dieses Paper? Zitate, Gedanken, Seitenzahlen …";
    ta.value = p.notes || "";
    body.append(ta);
    const actions = el("div", "pd-actions");
    const saveBtn = el("button", null, "Speichern");
    saveBtn.addEventListener("click", () => {
      p.notes = ta.value.trim();
      save();
      render();
      $("paper-dialog").close();
    });
    actions.append(saveBtn);
    body.append(actions);
    $("paper-dialog").showModal();
    ta.focus();
    return;
  } else if (view === "passages") {
    passagesView(p, body);
  } else {
    infoView(p, body);
  }
  if (!$("paper-dialog").open) $("paper-dialog").showModal();
}

// Passagen: selbst kopierte Textstellen, markiert als in der Arbeit benutzt / nicht benutzt
function passagesView(p, body) {
  p.passages = p.passages || [];
  const used = p.passages.filter((x) => x.used).length;
  body.append(el("h4", null, `Passagen (${p.passages.length} gesammelt, ${used} benutzt)`));
  const list = el("div", "ps-list");
  if (!p.passages.length) list.append(el("p", "ps-empty", "Noch keine Passage. Füge unten eine Textstelle aus dem Paper ein."));
  for (const ps of p.passages) {
    const item = el("div", "ps-item" + (ps.used ? " used" : ""));
    item.append(el("blockquote", "ps-text", ps.text));
    const meta = [ps.page ? `S. ${ps.page}` : "", ps.comment].filter(Boolean).join(" · ");
    if (meta) item.append(el("div", "ps-meta", meta));
    const row = el("div", "ps-row");
    const tog = el("button", "ps-toggle" + (ps.used ? " on" : ""), ps.used ? "✓ In der Arbeit benutzt" : "Nicht benutzt");
    tog.title = "Umschalten";
    tog.addEventListener("click", () => { ps.used = !ps.used; save(); render(); openPaper(p.id, "passages"); });
    const copy = el("button", "ps-small", "Kopieren");
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(ps.text).then(() => { copy.textContent = "Kopiert ✓"; setTimeout(() => (copy.textContent = "Kopieren"), 1200); });
    });
    const del = el("button", "ps-small danger", "Löschen");
    del.addEventListener("click", () => {
      if (!confirm("Diese Passage löschen?")) return;
      p.passages = p.passages.filter((x) => x !== ps);
      save(); render(); openPaper(p.id, "passages");
    });
    row.append(tog, copy, del);
    item.append(row);
    list.append(item);
  }
  body.append(list);

  body.append(el("h4", null, "Neue Passage"));
  const ta = el("textarea", "ps-new");
  ta.rows = 4;
  ta.placeholder = "Textstelle aus dem Paper hier einfügen …";
  const line = el("div", "ps-inputs");
  const page = el("input", "ps-page");
  page.type = "text";
  page.placeholder = "Seite";
  const comment = el("input", "ps-comment");
  comment.type = "text";
  comment.placeholder = "Kommentar (optional), z. B. Kap. 2, Gegenposition";
  line.append(page, comment);
  const actions = el("div", "pd-actions");
  const add = el("button", null, "Passage hinzufügen");
  add.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    p.passages.push({
      id: "ps_" + Date.now().toString(36),
      text, page: page.value.trim(), comment: comment.value.trim(),
      used: false, added: new Date().toISOString(),
    });
    save(); render(); openPaper(p.id, "passages");
  });
  actions.append(add);
  body.append(ta, line, actions);
}

function infoView(p, body) {
  const byId = Object.fromEntries(state.papers.map((x) => [x.id, x]));
  const badges = el("div", "pd-badges");
  badges.append(el("span", "badge", subtopicName(p.subtopic)), el("span", "badge", `${RING_LABEL[p.ring] || "relevant"} für dieses Unterthema`));
  if (!p.abstract) badges.append(el("span", "badge warn", "ohne Abstract eingeordnet"));
  if (p.footprint) badges.append(el("span", "badge", `${(p.footprint.energy_kwh * 1000).toFixed(2)} Wh · ${(p.footprint.carbon_kg * 1000).toFixed(2)} g CO₂`));
  body.append(badges);

  const mine = state.links.filter((l) => l.from === p.id || l.to === p.id);
  if (mine.length) {
    body.append(el("h4", null, "Verbindungen"));
    const ul = el("ul", "pd-links");
    for (const l of mine) {
      const outgoing = l.from === p.id;
      const other = byId[outgoing ? l.to : l.from];
      const name = other ? other.title : shortId(outgoing ? l.to : l.from);
      const text = l.type === "cites"
        ? (outgoing ? `zitiert: ${name}` : `wird zitiert von: ${name}`)
        : `thematisch nah an: ${name}${l.reason ? ` (${l.reason})` : ""}`;
      ul.append(el("li", null, text));
    }
    body.append(ul);
  }

  // Volltext: über OpenAlex (1 Cent, danach lokal gespeichert) oder freie Fassung
  if (p.hasPdf === undefined) {
    const hint = el("div", "status", "Prüfe, ob es eine PDF gibt …");
    body.append(hint);
    Api.openAlex(`https://api.openalex.org/works/${shortId(p.id)}?select=has_content,best_oa_location`)
      .then((w) => { Object.assign(p, pdfInfo(w)); save(); if ($("paper-dialog").open) openPaper(p.id, "info"); })
      .catch(() => { hint.textContent = "PDF-Prüfung fehlgeschlagen."; });
  } else {
    const pdf = el("div", "pd-pdf");
    const url = p.hasPdf ? Api.pdfUrl(p.id) : null;
    if (url) {
      const b = el("button", null, "PDF öffnen");
      b.addEventListener("click", () => window.open(url, "_blank", "noopener"));
      pdf.append(b, el("span", "pd-pdf-hint", "beim ersten Öffnen 1 Cent über OpenAlex, danach lokal gespeichert"));
    } else if (p.oaPdfUrl) {
      const a = el("a", "pd-doi", "Freie PDF-Fassung öffnen");
      a.href = p.oaPdfUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
      pdf.append(a);
    } else {
      pdf.append(el("span", "pd-pdf-hint", "Keine freie PDF bekannt. Über die DOI bzw. das Uni-Netz kommst du meist trotzdem dran."));
    }
    body.append(pdf);
  }

  if (/^10\.\d{4,9}\//.test(p.doi || "")) {
    const a = el("a", "pd-doi", `DOI: ${p.doi}`);
    a.href = "https://doi.org/" + encodeURI(p.doi);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    body.append(a);
  }
  const del = el("button", "ghost pd-delete", "Aus dem Gehirn löschen");
  del.addEventListener("click", () => { if (deletePaper(p.id)) $("paper-dialog").close(); });
  const actions = el("div", "pd-actions");
  actions.append(del);
  body.append(actions);
}

function renderMindmap() {
  const box = $("mindmap");
  Mindmap.render(box, state, (id, kind) => (kind === "copilot" ? Copilot.addRef("paper", id) : openPaper(id, kind)));
  if (!state.papers.length) box.prepend(el("div", "empty", "Noch keine Literatur. Lege links Unterthemen an und füge dein erstes Paper hinzu."));
}

function render() { renderFootprint(); renderMindmap(); if (typeof Biblio !== "undefined") Biblio.refresh(); }

// ── Unterthemen (legt Johanna selbst fest) ───────────────────────────────
function renderSubtopics() {
  const box = $("subtopics");
  box.replaceChildren();
  if (!state.subtopics.length) {
    box.append(el("div", "empty", "Noch keine Unterthemen. Lege unten mindestens eins an."));
    return;
  }
  for (const u of state.subtopics) {
    const row = el("div", "sub-item");
    const txt = el("div", "sub-text");
    txt.append(el("div", "sub-name", u.name));
    if (u.description) txt.append(el("div", "sub-desc", u.description));
    const count = state.papers.filter((p) => p.subtopic === u.id).length;
    txt.append(el("div", "sub-desc", `${count} Paper${count === 1 ? "" : "s"}`));
    const del = el("button", "ghost sub-del", "×");
    del.title = "Unterthema entfernen";
    del.setAttribute("aria-label", `Unterthema ${u.name} entfernen`);
    del.addEventListener("click", () => {
      if (count && !confirm(`„${u.name}“ entfernen? ${count} Paper${count === 1 ? "" : "s"} landen dann bei „Noch nicht zugeordnet“.`)) return;
      state.subtopics = state.subtopics.filter((x) => x.id !== u.id);
      for (const p of state.papers) if (p.subtopic === u.id) p.subtopic = null;
      save(); renderSubtopics(); render();
    });
    row.append(txt, del);
    box.append(row);
  }
}
function addSubtopic(name, description) {
  state.subtopics.push({ id: "u" + Date.now().toString(36), name, description });
  save(); renderSubtopics(); render();
}

// ── Export / Import ──────────────────────────────────────────────────────
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `literatur-gehirn-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.papers) || !Array.isArray(data.links)) throw new Error("Kein gültiges Gehirn");
    state = migrate({ ...emptyState(), ...data });
    save();
    $("topic").value = state.topic;
    $("topic-title").value = state.topicTitle;
    renderSubtopics();
    render();
  } catch (e) { alert(`Import fehlgeschlagen: ${e.message}`); }
}

// ── Start ────────────────────────────────────────────────────────────────
$("topic").value = state.topic;
$("topic-title").value = state.topicTitle;
$("topic-title").addEventListener("input", () => { state.topicTitle = $("topic-title").value.trim() || DEFAULT_TOPIC_TITLE; save(); renderMindmap(); });
$("topic").addEventListener("change", () => { state.topic = $("topic").value.trim() || DEFAULT_TOPIC; save(); renderMindmap(); });

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("search-input").value.trim();
  if (!q) return;
  $("selected").hidden = true;
  setStatus("search-status", "Suche bei OpenAlex …");
  try {
    renderResults(await search(q));
    setStatus("search-status", "");
  } catch (err) {
    setStatus("search-status", `Suche fehlgeschlagen: ${err.message}`, true);
  }
});
$("btn-add").addEventListener("click", () => addPaper());
$("btn-cancel").addEventListener("click", resetSelection);
$("subtopic-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("sub-name").value.trim();
  if (!name) return;
  addSubtopic(name, $("sub-desc").value.trim());
  $("sub-name").value = ""; $("sub-desc").value = "";
});
$("paper-close").addEventListener("click", () => $("paper-dialog").close());
$("paper-dialog").addEventListener("click", (e) => { if (e.target === $("paper-dialog")) $("paper-dialog").close(); });
$("btn-export").addEventListener("click", exportJson);
$("file-import").addEventListener("change", (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });

// Seitenleiste ein-/ausklappen (Zustand im Browser merken)
const SIDEBAR_KEY = "literatur-gehirn-sidebar";
function setSidebar(collapsed) {
  $("layout").classList.toggle("collapsed", collapsed);
  const btn = $("btn-sidebar");
  btn.textContent = collapsed ? "›" : "‹";
  btn.title = collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen";
  btn.setAttribute("aria-expanded", String(!collapsed));
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch { /* egal */ }
}
$("btn-sidebar").addEventListener("click", (e) => { e.stopPropagation(); setSidebar(!$("layout").classList.contains("collapsed")); });
document.querySelector(".panel.left").addEventListener("click", () => { if ($("layout").classList.contains("collapsed")) setSidebar(false); });
let startCollapsed = false;
try { startCollapsed = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { /* egal */ }
setSidebar(startCollapsed);

renderSubtopics();
render();
Copilot.init($("canvas-wrap"), () => state, (footprint, question) => {
  state.checks.push({ title: "Copilot: " + question.slice(0, 60), result: "copilot", at: new Date().toISOString(), footprint });
  save();
  renderFootprint();
}, (paperId, question, answer) => {
  const p = state.papers.find((x) => x.id === paperId);
  if (!p) return;
  const date = new Date().toLocaleDateString("de-DE");
  const entry = `Copilot, ${date}\nFrage: ${question}\n${answer}`;
  p.notes = p.notes ? `${p.notes}\n\n${entry}` : entry;
  save();
  render();
});
