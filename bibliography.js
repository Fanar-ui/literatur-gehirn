// Literaturverzeichnis über den Baum: Modus "cite" -> Freigabe -> Webhook
// (Zitier-Service, citeproc-js). Das Ergebnis kommt per data_response zurück.
// Nur Paper mit mindestens einer als "benutzt" markierten Passage.
const Biblio = (() => {
  const WEBHOOK_ID = "webhook_559e7d3a";
  const STYLES = [
    ["apa", "APA 7"],
    ["din-1505-2", "DIN 1505-2"],
    ["harvard-cite-them-right", "Harvard (Cite Them Right)"],
    ["chicago-author-date", "Chicago (Autor-Jahr)"],
    ["ieee", "IEEE"],
    ["modern-language-association", "MLA"],
  ];
  let pending = null;   // {payload, token} während die Freigabe-Frage offen ist
  let last = null;      // letztes Ergebnis für "Kopieren"

  function usedPapers() {
    return state.papers.filter((p) => p.doi && (p.passages || []).some((x) => x.used));
  }
  function buildPayload() {
    const items = usedPapers().map((p) => ({
      doi: p.doi,
      pages: [...new Set(p.passages.filter((x) => x.used && x.page).map((x) => x.page))],
    }));
    return { mode: "cite", query: "Modus: Literaturverzeichnis", style: state.citeStyle || "apa", items };
  }
  const extra = (permission) => ({
    node_response_fields: [],
    data_response_fields: { [WEBHOOK_ID]: [""] },
    ...(permission ? { permission } : {}),
  });

  function refresh() {
    const n = usedPapers().length;
    $("btn-bib").disabled = n === 0 || !!pending;
    $("bib-hint").textContent = n
      ? `${n} Paper mit benutzten Passagen kommen ins Verzeichnis.`
      : "Noch kein Paper mit einer als „in der Arbeit benutzt“ markierten Passage.";
  }

  async function start() {
    const payload = buildPayload();
    if (!payload.items.length) return;
    $("bib-result").hidden = true;
    setStatus("bib-status", "Frage den Baum …");
    $("btn-bib").disabled = true;
    try {
      handle(await Api.askTree(payload, extra()), payload);
    } catch (e) {
      setStatus("bib-status", e.message || String(e), true);
      refresh();
    }
  }

  function handle(res, payload) {
    if (res.status === "permission_required") {
      pending = { payload, token: res.permission.token };
      $("bib-question").textContent = res.permission.question;
      $("bib-permission").hidden = false;
      setStatus("bib-status", "");
      return;
    }
    pending = null;
    $("bib-permission").hidden = true;
    refresh();
    const value = res.data_response && res.data_response[WEBHOOK_ID] && res.data_response[WEBHOOK_ID][""];
    if (value == null) {
      // Nein-Zweig oder Webhook lief nicht: Text-Node-Antwort zeigen
      const text = res.node_response && res.node_response.text;
      setStatus("bib-status", text || "Kein Ergebnis vom Zitier-Service.", !text);
      return;
    }
    if (typeof value === "string") { setStatus("bib-status", value, true); return; }  // Fallback-Text
    show(value);
  }

  async function answer(allowed) {
    if (!pending) return;
    const { payload, token } = pending;
    $("bib-yes").disabled = $("bib-no").disabled = true;
    setStatus("bib-status", allowed ? "Zitier-Service formatiert …" : "");
    try {
      handle(await Api.askTree(payload, extra({ token, decision: allowed ? "allowed" : "denied" })), payload);
    } catch (e) {
      pending = null;
      $("bib-permission").hidden = true;
      setStatus("bib-status", e.message || String(e), true);
      refresh();
    } finally {
      $("bib-yes").disabled = $("bib-no").disabled = false;
    }
  }

  // citeproc-HTML sicher übernehmen: nur Text, Kursiv und Fett
  function safeInline(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const out = document.createDocumentFragment();
    (function walk(src, dst) {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) { dst.append(n.textContent); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        const style = (n.getAttribute("style") || "").toLowerCase();
        let target = dst;
        if (tag === "i" || tag === "em" || style.includes("italic")) { target = document.createElement("i"); dst.append(target); }
        else if (tag === "b" || tag === "strong" || style.includes("bold")) { target = document.createElement("b"); dst.append(target); }
        walk(n, target);
      }
    })(doc.body.firstChild, out);
    return out;
  }

  function show(r) {
    last = r;
    const box = $("bib-entries");
    box.replaceChildren();
    box.classList.toggle("no-indent", !r.hanging_indent);
    const citesByDoi = Object.fromEntries((r.citations || []).map((c) => [String(c.doi).toLowerCase(), c]));
    for (const e of r.entries || []) {
      const div = el("div", "bib-entry");
      div.append(safeInline(e.html || e.text));
      const c = citesByDoi[String(e.doi).toLowerCase()];
      if (c) {
        const refs = [c.text, ...(c.with_pages || []).map((p) => p.text)];
        div.append(el("div", "bib-cites", "Im Text: " + refs.join("  ·  ")));
      }
      box.append(div);
    }
    if ((r.errors || []).length) {
      box.append(el("div", "bib-errors", "Nicht gefunden: " + r.errors.map((x) => x.doi).join(", ")));
    }
    $("bib-result").hidden = false;
    setStatus("bib-status", `${r.count} Einträge in ${r.style_name}.`);
  }

  async function copy() {
    if (!last) return;
    const html = (last.entries || []).map((e) => `<p>${e.html || e.text}</p>`).join("");
    const text = last.bibliography_text || "";
    try {
      // HTML behält die Kursivschrift beim Einfügen in Word
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    $("bib-copy").textContent = "Kopiert ✓";
    setTimeout(() => ($("bib-copy").textContent = "Verzeichnis kopieren"), 1400);
  }

  // ── Start ──
  const sel = $("bib-style");
  for (const [id, name] of STYLES) { const o = el("option", null, name); o.value = id; sel.append(o); }
  sel.value = state.citeStyle || "apa";
  sel.addEventListener("change", () => { state.citeStyle = sel.value; save(); });
  $("btn-bib").addEventListener("click", start);
  $("bib-yes").addEventListener("click", () => answer(true));
  $("bib-no").addEventListener("click", () => answer(false));
  $("bib-copy").addEventListener("click", copy);
  refresh();

  return { refresh };
})();
