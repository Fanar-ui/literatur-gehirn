// Mindmap mit drei Ebenen: Hauptthema (Mitte) -> Unterthemen (Kreis darum)
// -> Literatur auf drei Kreisen um ihr Unterthema (1 = zentral, innen).
// Eigenes SVG ohne Bibliothek. Texte nur über textContent (nie als HTML).
const Mindmap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, H = 720, CX = W / 2, CY = H / 2;
  const RING_R = [0, 46, 72, 98];          // Radius je Kreis 1..3
  const UNASSIGNED = "__none";
  const SHOW_LINKS = false;                 // Verbindungen vorerst ausgeblendet
  const COLORS = ["#009ed4", "#ff7a59", "#2bb673", "#f5b700", "#8e6cef", "#ef5da8", "#00a6a6"];
  const GREY = "#8a99a6";

  let view = null, home = null, userMoved = false, dragMoved = false;
  let expanded = null;   // Paper, dessen drei kleine Punkte gerade offen sind
  let last = null;       // letzte Render-Argumente, um nach einem Klick neu zu zeichnen
  const SATELLITES = [
    { kind: "summary", icon: "≡", label: "Zusammenfassung" },
    { kind: "notes", icon: "✎", label: "Notizen" },
    { kind: "passages", icon: "❝", label: "Passagen" },
    { kind: "info", icon: "i", label: "Infos" },
    { kind: "copilot", icon: "@", label: "In den Copilot" },
  ];
  function firstSentence(t, n = 140) {
    const m = String(t || "").match(/^.*?[.!?](\s|$)/);
    return short((m ? m[0] : String(t || "")).trim(), n);
  }
  function hoverText(kind, p) {
    if (kind === "summary") return p.summary ? firstSentence(p.summary) : "Noch keine Zusammenfassung";
    if (kind === "notes") return p.notes ? short(p.notes, 140) : "Noch keine Notiz. Klicken zum Schreiben.";
    if (kind === "passages") {
      const all = p.passages || [], used = all.filter((x) => x.used).length;
      return all.length ? `${all.length} gesammelt, ${used} in der Arbeit benutzt` : "Noch keine Passage. Klicken zum Einfügen.";
    }
    if (kind === "copilot") return "Dieses Paper als Etikett in den Copilot einfügen";
    return [p.authors, p.year, p.venue].filter(Boolean).join(" · ") || "Infos";
  }

  function s(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  function short(t, n) { return t.length > n ? t.slice(0, n - 1) + "…" : t; }
  function pill(x, y, text, color, cls, fillColor) {
    const g = s("g", { class: cls });
    const w = text.length * 7 + 18;
    g.append(s("rect", { x: x - w / 2, y: y - 12, width: w, height: 24, rx: 12, fill: fillColor || "#fff", stroke: color, "stroke-width": 1.5 }));
    g.append(s("text", { x, y: y + 4, "text-anchor": "middle" }, text));
    return g;
  }
  function curve(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1, bend = Math.min(60, len * 0.2);
    return `M${a.x},${a.y} Q${mx - (dy / len) * bend},${my + (dx / len) * bend} ${b.x},${b.y}`;
  }

  function groupsOf(state) {
    const subs = state.subtopics || [];
    const known = new Set(subs.map((u) => u.id));
    const groups = subs.map((u, i) => ({ ...u, color: COLORS[i % COLORS.length], papers: state.papers.filter((p) => p.subtopic === u.id) }));
    const rest = state.papers.filter((p) => !known.has(p.subtopic));
    if (rest.length) groups.push({ id: UNASSIGNED, name: "Noch nicht zugeordnet", description: "Papers, die zu keinem deiner Unterthemen passen", color: GREY, papers: rest });
    return groups;
  }

  function layout(groups) {
    const n = groups.length;
    const D = n ? Math.max(230, (n * 240) / (2 * Math.PI)) : 0;
    const gpos = {}, ppos = {};
    groups.forEach((g, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
      const gx = CX + D * Math.cos(a), gy = CY + D * Math.sin(a);
      gpos[g.id] = { x: gx, y: gy, a };
      for (const ring of [1, 2, 3]) {
        const members = g.papers.filter((p) => (p.ring || 2) === ring);
        members.forEach((p, k) => {
          const pa = a + Math.PI + ring * 0.5 + (k * 2 * Math.PI) / members.length;
          ppos[p.id] = { x: gx + RING_R[ring] * Math.cos(pa), y: gy + RING_R[ring] * Math.sin(pa) };
        });
      }
    });
    const ext = D + RING_R[3] + 50;
    let h = Math.max(H * 0.6, ext * 2), w = (h * W) / H;
    if (w < ext * 2) { w = ext * 2; h = (w * H) / W; }
    return { gpos, ppos, home: { x: CX - w / 2, y: CY - h / 2, w, h } };
  }

  function render(container, state, onAction) {
    last = { container, state, onAction };
    if (expanded && !state.papers.some((p) => p.id === expanded)) expanded = null;
    container.replaceChildren();
    const groups = groupsOf(state);
    const { gpos, ppos, home: newHome } = layout(groups);
    home = newHome;
    if (!view || !userMoved) view = { ...home };

    const svg = s("svg", { viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`, class: "mindmap-svg", role: "img", "aria-label": "Mindmap der Literatur" });
    const defs = s("defs");
    const pat = s("pattern", { id: "dots", width: 22, height: 22, patternUnits: "userSpaceOnUse" });
    pat.append(s("circle", { cx: 2, cy: 2, r: 1.4, fill: "#cdd6de" }));
    defs.append(pat);
    const marker = s("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "19", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.append(s("path", { d: "M0,0 L10,5 L0,10 z", fill: "#00385f" }));
    defs.append(marker);
    svg.append(defs);
    svg.append(s("rect", { x: -6000, y: -6000, width: 13000, height: 13000, fill: "#f7f9fb" }));
    svg.append(s("rect", { x: -6000, y: -6000, width: 13000, height: 13000, fill: "url(#dots)" }));

    // Speichen Hauptthema -> Unterthemen und die drei Kreise je Unterthema
    for (const g of groups) {
      const q = gpos[g.id];
      svg.append(s("line", { x1: CX, y1: CY, x2: q.x, y2: q.y, class: "mm-spoke", stroke: g.color }));
      for (const ring of [1, 2, 3]) svg.append(s("circle", { cx: q.x, cy: q.y, r: RING_R[ring], class: "mm-ring", stroke: g.color }));
    }

    // Fäden vom Unterthema zu seiner Literatur
    for (const g of groups) {
      const q = gpos[g.id];
      for (const p of g.papers) {
        const t = ppos[p.id];
        if (t) svg.append(s("line", { x1: q.x, y1: q.y, x2: t.x, y2: t.y, class: "mm-string", stroke: g.color }));
      }
    }

    // Verbindungen (vorerst aus)
    if (SHOW_LINKS) {
      for (const l of state.links) {
        const a = ppos[l.from], b = ppos[l.to];
        if (!a || !b) continue;
        const path = s("path", { d: curve(a, b), class: l.type === "cites" ? "mm-link cites" : "mm-link theme", ...(l.type === "cites" ? { "marker-end": "url(#arrow)" } : {}) });
        svg.append(path);
      }
    }

    // Hauptthema
    const center = s("g", { class: "mm-center-node" });
    center.append(s("circle", { cx: CX, cy: CY, r: 14, class: "mm-halo" }));
    center.append(s("circle", { cx: CX, cy: CY, r: 14, class: "mm-center" }));
    center.append(s("title", {}, `${state.topicTitle || "Hauptthema"}\n\n${state.topic}`));
    svg.append(center);

    // Unterthemen
    for (const g of groups) {
      const q = gpos[g.id];
      const node = s("g", { class: "mm-sub" + (g.id === UNASSIGNED ? " unassigned" : "") });
      node.append(s("circle", { cx: q.x, cy: q.y, r: 20, fill: g.color, "fill-opacity": 0.2, stroke: g.color, "stroke-width": 3 }));
      node.append(s("circle", { cx: q.x, cy: q.y, r: 7, fill: g.color }));
      node.append(s("title", {}, `${g.name}${g.description ? "\n" + g.description : ""}\n${g.papers.length} Papers`));
      svg.append(node);
      svg.append(pill(q.x, q.y + (q.y >= CY ? RING_R[3] + 22 : -RING_R[3] - 22), short(g.name, 32), g.color, "mm-sub-label", "#fff"));
    }

    // Literatur
    const colorOf = Object.fromEntries(groups.flatMap((g) => g.papers.map((p) => [p.id, g.color])));
    for (const p of state.papers) {
      const q = ppos[p.id];
      if (!q) continue;
      const c = colorOf[p.id] || GREY;
      const node = s("g", { class: "mm-node", tabindex: "0" });
      const bubble = s("g", { class: "mm-bubble" });
      bubble.append(s("circle", { cx: q.x, cy: q.y, r: 10, fill: c, "fill-opacity": 0.25, stroke: c, "stroke-width": 2.5 }));
      bubble.append(s("circle", { cx: q.x, cy: q.y, r: 4, fill: c }));
      // Passagen-Marker: voll = mind. eine Passage benutzt, leer = nur gesammelt
      const ps = p.passages || [];
      if (ps.length) {
        const usedAny = ps.some((x) => x.used);
        bubble.append(s("circle", {
          cx: q.x + 9, cy: q.y - 9, r: 3.6, class: "mm-pass-mark",
          fill: usedAny ? c : "#fff", stroke: c, "stroke-width": 1.6,
        }));
      }
      node.append(bubble);
      node.append(s("title", {}, `${p.title}\n${p.authors} ${p.year}`));
      const toggle = () => { expanded = expanded === p.id ? null : p.id; rerender(); };
      node.addEventListener("click", () => { if (!dragMoved) toggle(); });
      node.addEventListener("keydown", (e) => { if (e.key === "Enter") toggle(); });
      svg.append(node);
    }

    // Drei kleine Punkte um das angeklickte Paper
    const open = expanded && state.papers.find((p) => p.id === expanded);
    if (open && ppos[open.id]) {
      const q = ppos[open.id];
      const grp = groups.find((g) => g.papers.includes(open));
      const gq = grp ? gpos[grp.id] : { x: CX, y: CY };
      const base = Math.atan2(q.y - gq.y, q.x - gq.x) || -Math.PI / 2;
      const c = colorOf[open.id] || GREY;
      SATELLITES.forEach((sat, i) => {
        const a = base + (i - (SATELLITES.length - 1) / 2) * 0.7;
        const x = q.x + 32 * Math.cos(a), y = q.y + 32 * Math.sin(a);
        svg.append(s("line", { x1: q.x, y1: q.y, x2: x, y2: y, class: "mm-sat-line", stroke: c }));
        const g = s("g", { class: "mm-sat", tabindex: "0" });
        g.append(s("circle", { cx: x, cy: y, r: 9, fill: "#fff", stroke: c, "stroke-width": 2 }));
        g.append(s("text", { x, y: y + 4, "text-anchor": "middle", class: "mm-sat-icon", fill: c }, sat.icon));
        g.append(s("title", {}, `${sat.label}: ${hoverText(sat.kind, open)}`));
        const act = () => onAction(open.id, sat.kind);
        g.addEventListener("click", (e) => { e.stopPropagation(); if (!dragMoved) act(); });
        g.addEventListener("keydown", (e) => { if (e.key === "Enter") act(); });
        svg.append(g);
      });
    }

    // Klick ins Leere klappt die Punkte wieder zu
    svg.addEventListener("click", (e) => {
      if (dragMoved || !expanded) return;
      if (e.target.closest && e.target.closest(".mm-node, .mm-sat")) return;
      expanded = null;
      rerender();
    });

    const stage = document.createElement("div");
    stage.className = "mm-stage";
    stage.append(svg);
    container.append(stage);
    enablePanZoom(svg);
    stage.append(controls(svg));
  }

  function rerender() { if (last) render(last.container, last.state, last.onAction); }

  // ── Greifen und Zoomen wie im Decision Tree Builder ──────────────────
  function applyView(svg) { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function toSvg(svg, clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  }
  function zoomAt(svg, factor, px, py) {
    const newW = Math.min(home.w * 3, Math.max(home.w / 6, view.w * factor));
    const f = newW / view.w;
    view = { x: px - (px - view.x) * f, y: py - (py - view.y) * f, w: newW, h: view.h * f };
    userMoved = true;
    applyView(svg);
  }
  function enablePanZoom(svg) {
    let start = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      start = { cx: e.clientX, cy: e.clientY, x: view.x, y: view.y };
      dragMoved = false;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!start) return;
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - start.cx, dy = e.clientY - start.cy;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 4) {
        dragMoved = true;
        svg.setPointerCapture(e.pointerId);   // erst beim echten Ziehen, sonst kommen Klicks nicht an
        svg.classList.add("grabbing");
      }
      if (!dragMoved) return;
      view.x = start.x - dx * (view.w / r.width);
      view.y = start.y - dy * (view.h / r.height);
      userMoved = true;
      applyView(svg);
    });
    const end = (e) => {
      if (!start) return;
      start = null;
      svg.classList.remove("grabbing");
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      setTimeout(() => { dragMoved = false; }, 0);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = toSvg(svg, e.clientX, e.clientY);
      zoomAt(svg, Math.pow(1.0015, e.deltaY), p.x, p.y);
    }, { passive: false });
    svg.addEventListener("dblclick", (e) => {
      if (e.target.closest && e.target.closest(".mm-node, .mm-sat")) return;
      const p = toSvg(svg, e.clientX, e.clientY);
      zoomAt(svg, 0.6, p.x, p.y);
    });
  }
  function controls(svg) {
    const box = document.createElement("div");
    box.className = "mm-controls";
    const btn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      return b;
    };
    const mid = () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 });
    box.append(
      btn("+", "Hineinzoomen", () => { const m = mid(); zoomAt(svg, 0.8, m.x, m.y); }),
      btn("−", "Herauszoomen", () => { const m = mid(); zoomAt(svg, 1.25, m.x, m.y); }),
      btn("⤢", "Alles anzeigen", () => { view = { ...home }; userMoved = false; applyView(svg); }),
    );
    return box;
  }

  return { render };
})();
