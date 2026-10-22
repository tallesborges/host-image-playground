// Script for the contact list frame. It runs on the host origin, inside the frame.
// It has no contact data: it reads the list from the frame document.
// Messages to the product page carry only an opaque id.
export function listScript(productOrigin) {
  return `"use strict";
(() => {
  const PARENT = ${JSON.stringify(productOrigin)};
  const channel = new URLSearchParams(location.search).get("channel") || "";
  const q = document.getElementById("q");
  const buttons = [...document.querySelectorAll("#list button")];
  const empty = document.getElementById("empty");
  const send = (m) => parent.postMessage({ app: "host-demo", v: 1, channel, ...m }, PARENT);

  function select(id) {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.id === id));
  }

  q.addEventListener("input", () => {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    for (const b of buttons) {
      const hit = !term || b.dataset.search.includes(term);
      b.parentElement.hidden = !hit;
      shown += hit ? 1 : 0;
    }
    empty.hidden = shown > 0;
  });

  for (const b of buttons) {
    b.addEventListener("click", () => {
      select(b.dataset.id);
      send({ type: "select", id: b.dataset.id });
    });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== parent || e.origin !== PARENT) return;
    const m = e.data;
    if (!m || m.app !== "host-demo" || m.v !== 1 || m.channel !== channel || m.type !== "command") return;
    if (m.action === "focus-search") q.focus();
    else if (m.action === "clear-selection") select(null);
    else return;
    send({ type: "done", action: m.action, requestId: m.requestId });
  });

  send({ type: "ready" });
})();
`;
}
