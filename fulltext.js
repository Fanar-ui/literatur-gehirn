// Volltext: TEI-XML (Grobid, von OpenAlex) ohne KI in Abschnitte zerlegen
// und mit einfacher Wortsuche die passendsten Abschnitte finden.
const Fulltext = (() => {
  const CHUNK = 1400;            // Zeichen pro Suchstück
  const cache = new Map();       // OpenAlex-ID -> [{head, text}]

  const textOf = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");
  const byTag = (root, tag) => Array.from(root.getElementsByTagNameNS("*", tag));

  // XML -> Abschnitte (Überschrift + Text), lange Abschnitte in Stücke an Absatzgrenzen
  function parse(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XML nicht lesbar");
    const out = [];
    const abs = byTag(doc, "abstract")[0];
    if (abs && textOf(abs)) out.push({ head: "Abstract", text: textOf(abs) });
    const body = byTag(doc, "body")[0];
    if (body) {
      let n = 0;
      for (const div of Array.from(body.children).filter((c) => c.localName === "div")) {
        n++;
        const head = textOf(Array.from(div.children).find((c) => c.localName === "head")) || `Abschnitt ${n}`;
        const paras = Array.from(div.children).filter((c) => c.localName === "p").map(textOf).filter(Boolean);
        let buf = "";
        for (const p of paras) {
          if (buf && buf.length + p.length > CHUNK) { out.push({ head, text: buf }); buf = ""; }
          buf = buf ? buf + " " + p : p;
        }
        if (buf) out.push({ head, text: buf });
      }
    }
    return out;
  }

  async function sectionsFor(openAlexId) {
    const id = String(openAlexId).replace("https://openalex.org/", "");
    if (cache.has(id)) return cache.get(id);
    const res = await fetch("/_local/fulltext?id=" + encodeURIComponent(id));
    if (!res.ok) {
      let msg = `Fehler ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* egal */ }
      throw new Error(msg);
    }
    const sections = parse(await res.text());
    cache.set(id, sections);
    return sections;
  }

  // Wortsuche: ganze Begriffe zählen voll, einzelne Wörter aus Mehrwort-Begriffen
  // halb (z. B. "novice employees" findet auch "novice workers"). Treffer pro
  // Begriff gedeckelt, Bonus für viele verschiedene Begriffe.
  const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "level", "based", "related", "effect", "effects", "impact"]);
  function count(hay, needle, cap = 5) {
    let c = 0, i = hay.indexOf(needle);
    while (i !== -1 && c < cap) { c++; i = hay.indexOf(needle, i + needle.length); }
    return c;
  }
  function search(items, terms, limit = 5) {
    const phrases = [...new Set(terms.map((t) => String(t).toLowerCase().trim()).filter((t) => t.length > 2))];
    const words = [...new Set(phrases.flatMap((t) => (t.includes(" ") ? t.split(/\s+/) : [])))]
      .filter((w) => w.length > 3 && !STOP.has(w) && !phrases.includes(w));
    const scored = [];
    for (const it of items) {
      const hay = (it.head + " " + it.text).toLowerCase();
      let score = 0, distinct = 0;
      for (const t of phrases) { const c = count(hay, t); if (c) { distinct++; score += c * 2; } }
      for (const w of words) { const c = count(hay, w); if (c) { distinct += 0.5; score += c; } }
      if (score) scored.push({ ...it, score: score + distinct * 3 });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return { sectionsFor, search };
})();
