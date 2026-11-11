// Weiche: auf ecoxpo.app über EcoXPO (Key + Baum setzt EcoXPO selbst ein),
// lokal über dev_server.py (Key steht nur in .env.local).
const Api = (() => {
  const onXpo = () => typeof window.EcoXPO !== "undefined";

  async function postLocal(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data.error || data.detail || `Fehler ${res.status}`);
    return data;
  }

  async function openAlex(url) {
    if (onXpo()) {
      const res = await window.EcoXPO.fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`OpenAlex antwortet mit ${res.status}`);
      return res.json();
    }
    return postLocal("/_local/fetch", { url });
  }

  // extra: z. B. {data_response_fields, permission, node_response_fields}
  async function askTree(payload, extra = {}) {
    const options = { payload, node_response_fields: ["choices.0.message.content"], ...extra };
    if (onXpo()) return window.EcoXPO.askTree(null, options);
    return postLocal("/_local/tree", options);
  }

  // Adresse zum Öffnen der Volltext-PDF (vorerst nur lokal, der Key bleibt im Server)
  function pdfUrl(openAlexId) {
    if (onXpo()) return null;
    return "/_local/pdf?id=" + encodeURIComponent(String(openAlexId).replace("https://openalex.org/", ""));
  }

  return { openAlex, askTree, pdfUrl };
})();
