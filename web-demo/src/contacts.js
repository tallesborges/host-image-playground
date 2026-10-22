// Synthetic contacts. Only the host Worker uses names. The product page gets opaque aliases.
export const CONTACTS = [
  { id: "c_7hq2m9", name: "Alice Example", username: "@alice.example", color: "#2f6fb0" },
  { id: "c_3kd8w1", name: "Bob Sample", username: "@bob.sample", color: "#3f7d4e" },
  { id: "c_9xr4p6", name: "Carol Test", username: "@carol.test", color: "#a0522d" },
  { id: "c_5mv1z8", name: "Dan Demo", username: "@dan.demo", color: "#6b4fa0" },
  { id: "c_2bn7t3", name: "Eve Placeholder", username: "@eve.placeholder", color: "#8a6d1f" },
];

// An unknown alias gets a placeholder with the same size and status, so aliases cannot be probed.
export const UNKNOWN = { id: "", name: "Unknown contact", username: "", color: "#9a9a96" };

export const findContact = (id) => CONTACTS.find((c) => c.id === id) ?? UNKNOWN;

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Fixed sizes, so naturalWidth/naturalHeight do not depend on the contact.
export const AVATAR_PX = 112; // PNG, shown at 56 × 56
export const NAME_W = 240;
export const NAME_H = 48;

// The name and username as SVG text, for an <img>.
export function nameSvg(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${NAME_W}" height="${NAME_H}" viewBox="0 0 ${NAME_W} ${NAME_H}">
<text x="0" y="20" font-family="${FONT}" font-size="15" font-weight="600" fill="#1d1d1b">${esc(c.name)}</text>
<text x="0" y="40" font-family="${FONT}" font-size="13" fill="#6b6b66">${esc(c.username)}</text></svg>`;
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#1d1d1b;font:14px/1.4 ${FONT}}
.card{display:flex;align-items:center;gap:14px;width:100%;max-width:320px;height:88px;padding:0 16px;border:1px solid #e3e3df;border-radius:12px}
.card img{width:56px;height:56px;border-radius:50%;flex:none}
.name{font-size:15px;font-weight:600}.user{font-size:13px;color:#6b6b66}`;

const avatarPath = (c) => `/avatar/${esc(c.id || "unknown")}.png`;

// The contact as an HTML document, for an <iframe>.
export function contactHtml(c) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Contact</title>
<style>${BASE_CSS}</style>
<div class="card"><img src="${avatarPath(c)}" alt="">
<div><div class="name">${esc(c.name)}</div><div class="user">${esc(c.username)}</div></div></div></html>`;
}

// The contact list, for an <iframe>. Search and selection run inside the frame.
// The names are in this HTML only. The script (/embed/list.js) has no data, so a page
// that loads it with <script src> gets nothing.
export function listHtml() {
  const items = CONTACTS.map(
    (c) => `<li><button type="button" data-id="${esc(c.id)}" data-search="${esc(`${c.name} ${c.username}`.toLowerCase())}">
<img src="${avatarPath(c)}" alt=""><span><span class="name">${esc(c.name)}</span><span class="user">${esc(c.username)}</span></span></button></li>`,
  ).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Contacts</title>
<style>${BASE_CSS}
body{padding:12px}
input{width:100%;font:inherit;padding:8px 10px;border:1px solid #d6d6d1;border-radius:8px;margin-bottom:8px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
li button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border-radius:8px;cursor:pointer}
li button:hover{background:#f4f4f1}li button[aria-pressed=true]{background:#e8f0fa;outline:1px solid #2f6fb0}
li img{width:32px;height:32px;border-radius:50%}li .name{display:block;font-size:14px}li .user{display:block;font-size:12px}
.empty{color:#6b6b66;padding:8px}</style>
<input id="q" type="search" placeholder="Search contacts" autocomplete="off" aria-label="Search contacts">
<ul id="list">
${items}
</ul><p class="empty" id="empty" hidden>No match.</p>
<script src="/embed/list.js"></script></html>`;
}
