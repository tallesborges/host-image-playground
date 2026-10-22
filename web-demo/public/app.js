"use strict";

// The untrusted product page. It knows only the host origin and opaque contact aliases.
const HOST = window.DEMO.hostOrigin;
const ID = "c_7hq2m9";

// Test oracle only: the page uses these strings to check if a test got the name.
// A real product page does not have them.
const ORACLE = ["Alice Example", "@alice.example"];
const ALL_NAMES = [
  "Alice Example", "@alice.example", "Bob Sample", "@bob.sample", "Carol Test", "@carol.test",
  "Dan Demo", "@dan.demo", "Eve Placeholder", "@eve.placeholder",
];

const CHANNEL = `list-${crypto.randomUUID().slice(0, 8)}`;
const LIST_URL = `${HOST}/embed/list?channel=${CHANNEL}`;

// The IMG idea uses two images: the avatar as a PNG picture and the name as SVG text.
const parts = (base) => [
  { key: "avatar", label: "Avatar (PNG)", type: "png", url: `${base}/avatar.png`, w: 56, h: 56 },
  { key: "name", label: "Name (SVG text)", type: "svg", url: `${base}/name.svg`, w: 240, h: 48 },
];

const COMPARE = [
  { id: "img", mode: "img", kind: "test", tag: "IMG idea", title: "Two images from the host",
    parts: parts(`${HOST}/img/${ID}`), expect: "blocked", knows: `${HOST}/img/${ID}/avatar.png, …/name.svg`,
    note: "<img src=\"host URL\"> for the avatar and for the name. The host sends no CORS header." },
  { id: "frame", mode: "frame", rows: "host", kind: "test", tag: "iframe idea", title: "One frame from the host",
    url: `${HOST}/embed/contact?id=${ID}`, expect: "blocked", knows: `${HOST}/embed/contact?id=${ID}`,
    note: "<iframe sandbox=\"allow-scripts allow-same-origin\" referrerpolicy=\"no-referrer\">. The frame shows the same PNG avatar and the name as HTML text. The host allows only this origin to embed it." },
  { id: "control", mode: "img", kind: "ctl", tag: "Control", title: "Same images, this page's origin",
    parts: parts(`/same/${ID}`), expect: "read", knows: `/same/${ID}/avatar.png, …/name.svg`,
    note: "This page's own server sends the same two images. The page must be able to read them." },
];

const MORE = [
  { id: "corsimg", mode: "img", kind: "ctl", tag: "Control", title: "Images from the host, CORS allowed",
    parts: parts(`${HOST}/cors/${ID}`), crossOrigin: "anonymous", expect: "read",
    expectOverride: { "avatar-nocors": "blocked", "name-nocors": "blocked" },
    note: "The host sends Access-Control-Allow-Origin: *. The images use crossOrigin=\"anonymous\". A no-cors fetch always stays opaque." },
  { id: "sameframe", mode: "frame", kind: "ctl", tag: "Control", title: "Frame from this page's origin",
    url: `/same-frame/${ID}`, expect: "read",
    note: "This page's own server sends the same contact document. The page must be able to read it." },
  { id: "corsframe", mode: "frame", kind: "ctl", tag: "Check", title: "Frame from the host, CORS allowed",
    url: `${HOST}/cors/${ID}/name.svg`, expect: "blocked",
    note: "The CORS name image, loaded in a frame. CORS does not give access to a frame, so the read must stay blocked." },
];

const LABEL = { read: "Readable", blocked: "Blocked", na: "No API", error: "Error", ...MEDIA_LABEL };
const bust = (u) => `${u}${u.includes("?") ? "&" : "?"}t=${Math.random().toString(36).slice(2)}`;
const errText = (e) => `${e && e.name}: ${e && e.message}`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const leaks = (secrets, t) => typeof t === "string" && secrets.some((s) => t.includes(s));
const highlight = (secrets, t) => secrets.reduce((h, s) => h.split(esc(s)).join(`<mark>${esc(s)}</mark>`), esc(t));
const snippet = (s, n = 180) => (s.length > n ? s.slice(0, n) + "…" : s);
function around(t, n = 180) {
  const hits = ORACLE.map((x) => t.indexOf(x)).filter((i) => i >= 0);
  if (!hits.length) return snippet(t, n);
  const start = Math.max(0, Math.min(...hits) - 40);
  return (start ? "…" : "") + snippet(t.slice(start), n);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Did the page get the content? For the name: the text. For the avatar: the PNG bytes.
function judgeBody(part, buf, card) {
  if (part.type === "png") {
    const b = new Uint8Array(buf);
    const isPng = b.length > 8 && PNG_SIG.every((v, i) => b[i] === v);
    if (isPng) card.addProof(`${part.label}: file that the page read`, Object.assign(new Image(), { src: URL.createObjectURL(new Blob([b], { type: "image/png" })), width: 56, height: 56 }));
    return { status: isPng ? "read" : "blocked", detail: isPng ? `body=${b.length} bytes of PNG data. The page drew it below.` : `body=${b.length} bytes` };
  }
  const t = new TextDecoder().decode(buf);
  const read = leaks(ORACLE, t);
  return { status: read ? "read" : "blocked", detail: `body=${t.length} chars${t ? `\n${highlight(ORACLE, around(t))}` : ""}` };
}

// Tests that read a URL directly. `target` is an image part or a frame card.
const NET = [
  { key: "fetch", name: "Read the file with fetch", code: "await (await fetch(url)).arrayBuffer()",
    async run(card, part) {
      try {
        const r = await fetch(bust(part.url)); const j = judgeBody(part, await r.arrayBuffer(), card);
        return { status: j.status, html: `type=${r.type} status=${r.status} ${j.detail}` };
      } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
    } },
  { key: "xhr", name: "Read the file with XHR", code: "xhr.responseType = 'arraybuffer'; xhr.response",
    run(card, part) {
      return new Promise((resolve) => {
        const x = new XMLHttpRequest(); x.open("GET", bust(part.url)); x.responseType = "arraybuffer";
        const done = (ev) => {
          const j = judgeBody(part, x.response || new ArrayBuffer(0), card);
          resolve({ status: j.status, html: `event=${ev} status=${x.status} ${j.detail}` });
        };
        x.onload = () => done("load"); x.onerror = () => done("error"); x.send();
      });
    } },
  { key: "nocors", name: "Read the file with a no-cors fetch", code: "await (await fetch(url, {mode:'no-cors'})).arrayBuffer()",
    async run(card, part) {
      try {
        const r = await fetch(bust(part.url), { mode: "no-cors" }); const j = judgeBody(part, await r.arrayBuffer(), card);
        return { status: j.status, html: `type=${r.type} status=${r.status} ${j.detail}` };
      } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
    } },
];

function drawToCanvas(img) {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth || 1; cv.height = img.naturalHeight || 1;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0);
  return { cv, ctx };
}

const PIXELS = { key: "pixels", name: "Read the pixels", code: "ctx.drawImage(img, 0, 0); ctx.getImageData(...)",
  async run(card, part) {
    let cv, ctx;
    try { ({ cv, ctx } = drawToCanvas(card.imgs[part.key])); } catch (e) { return { status: "error", html: `drawImage error: ${esc(errText(e))}` }; }
    try {
      const d = ctx.getImageData(0, 0, cv.width, cv.height);
      const out = document.createElement("canvas"); out.width = cv.width; out.height = cv.height;
      out.getContext("2d").putImageData(d, 0, 0);
      out.style.width = `${part.w}px`; out.style.height = `${part.h}px`;
      card.addProof(`${part.label}: pixels that the page read (copy)`, out);
      return { status: "read", html: `Got ${d.data.length / 4} pixels. The page drew a copy from them below.` };
    } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
  } };

const EXPORT = { key: "export", name: "Export the image", code: "canvas.toDataURL()",
  async run(card, part) {
    let cv;
    try { ({ cv } = drawToCanvas(card.imgs[part.key])); } catch (e) { return { status: "error", html: `drawImage error: ${esc(errText(e))}` }; }
    try {
      const u = cv.toDataURL("image/png");
      card.addProof(`${part.label}: image that the page exported`, Object.assign(new Image(), { src: u, width: part.w, height: part.h }));
      return { status: "read", html: `Got a PNG data URL (${u.length} chars). The exported copy is below.` };
    } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
  } };

function readFrameDocument(frame, secrets) {
  if (!frame || !frame.contentWindow) return { status: "error", html: "Not ready. Wait for the frame to load." };
  let doc;
  try { doc = frame.contentWindow.document; }
  catch (e) { return { status: e && e.name === "SecurityError" ? "blocked" : "error", html: `Throws ${esc(errText(e))}` }; }
  const t = ((doc.body ? doc.body.innerText : doc.documentElement && doc.documentElement.textContent) || "").trim();
  return { status: leaks(secrets, t) ? "read" : "blocked", html: `Returns the document. Read ${t.length} characters.\n${highlight(secrets, snippet(t))}` };
}

const FRAME_DOM = { key: "dom", name: "Read the frame document", code: "frame.contentWindow.document.body.innerText",
  async run(card) { return readFrameDocument(card.frame, ORACLE); } };

const FRAME_DOC = { key: "doc", name: "Read contentDocument", code: "frame.contentDocument",
  async run(card) {
    let d;
    try { d = card.frame.contentDocument; }
    catch (e) { return { status: "blocked", html: `Throws ${esc(errText(e))}` }; }
    if (d === null) return { status: "blocked", html: "Returns null. No error: the browser hides the document." };
    const t = (d.documentElement ? d.documentElement.textContent : "").trim();
    return { status: leaks(ORACLE, t) ? "read" : "blocked", html: `Returns the document.\n${highlight(ORACLE, snippet(t))}` };
  } };

const FRAME_PIXELS = { key: "pixels", expectAlways: "na", name: "Read the pixels", code: "ctx.drawImage(frame, 0, 0)",
  async run(card) {
    const ctx = document.createElement("canvas").getContext("2d");
    try { ctx.drawImage(card.frame, 0, 0); return { status: "read", html: "drawImage accepted the frame. This is not expected." }; }
    catch (e) { return { status: "na", html: `${esc(errText(e))}\ndrawImage does not accept a frame, for any origin. This is not an origin check.` }; }
  } };

const AVATAR = { key: "avatar", name: "Show the frame's avatar file directly", code: "new Image().src = host + '/avatar/<alias>.png'",
  run(card) {
    return new Promise((resolve) => {
      const img = new Image();
      img.width = 56; img.height = 56;
      img.onload = () => {
        card.addProof("Avatar that the page loaded", img);
        resolve({ status: "read", html: `The avatar loaded (${img.naturalWidth} × ${img.naturalHeight}). The page can show it.` });
      };
      img.onerror = () => resolve({ status: "blocked", html: "The image did not load. The host sends Cross-Origin-Resource-Policy: same-origin." });
      img.src = bust(`${HOST}/avatar/${ID}.png`);
    });
  } };

const SCRIPT = { key: "script", name: "Run the list frame script on this page", code: "<script src=\"host/embed/list.js\">",
  run() {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.onload = () => {
        s.remove();
        const t = document.body.innerText;
        resolve({ status: leaks(ALL_NAMES, t) ? "read" : "blocked", html: "The script ran, but it has no contact data. The names are only in the frame document." });
      };
      s.onerror = () => { s.remove(); resolve({ status: "blocked", html: "The script did not load. The host sends Cross-Origin-Resource-Policy: same-origin. The script also has no contact data." }); };
      s.src = bust(`${HOST}/embed/list.js`);
      document.head.appendChild(s);
    });
  } };

// Each row: { key, name, code, run(card), group? }.
function rowsFor(c) {
  if (c.mode === "video" || c.mode === "audio") return mediaRows(c);
  if (c.mode === "img") {
    const rows = [];
    for (const part of c.parts)
      for (const a of [...NET, PIXELS, EXPORT])
        rows.push({ ...a, key: `${part.key}-${a.key}`, group: part.label, run: (card) => a.run(card, part) });
    return rows;
  }
  const self = (a) => ({ ...a, run: (card) => a.run(card, { type: "svg", url: card.c.url }) });
  if (c.rows === "host") return [FRAME_DOM, FRAME_DOC, ...NET.map(self), AVATAR, SCRIPT, FRAME_PIXELS];
  return [FRAME_DOM, FRAME_DOC, FRAME_PIXELS];
}
const expectedFor = (c, a) => a.expectAlways || (c.expectOverride || {})[a.key] || c.expect;

// true, false, or "pending". Some media rows also accept "na" or "zero" (c.alt). "zero" passes only
// if the paired control gave real content, and "na" only if the control also had no API.
function matchRow(c, a, got) {
  if (got === expectedFor(c, a)) return true;
  if (!((c.alt || {})[a.key] || []).includes(got)) return false;
  if (!c.control) return true;
  const ctl = cards[c.control] && cards[c.control].results[a.key];
  if (!ctl) return "pending";
  return got === "zero" ? ctl === "read" : ctl === got;
}

function expectText(c) {
  if (c.expect === "blocked") return c.alt ? "Expected: blocked or only zeros" : "Expected: blocked";
  return c.expectOverride ? "Expected: readable, except no-cors" : "Expected: readable";
}

const grids = { compare: document.getElementById("grid-compare"), media: document.getElementById("grid-media"), more: document.getElementById("grid-more") };
const MEDIA = mediaCards(HOST, ID);
const cards = {};

function loadImages(card) {
  const box = document.createElement("div");
  box.className = "contact";
  card.imgs = {};
  const loads = card.c.parts.map((part) => new Promise((resolve) => {
    const img = new Image();
    if (card.c.crossOrigin) img.crossOrigin = card.c.crossOrigin;
    img.onload = async () => { try { await img.decode(); } catch {} resolve(true); };
    img.onerror = () => resolve(false);
    img.alt = part.key === "avatar" ? "Contact photo" : "Contact name";
    img.className = part.key;
    img.width = part.w; img.height = part.h;
    img.src = bust(part.url);
    card.imgs[part.key] = img;
    box.appendChild(img);
  }));
  card.shot.replaceChildren(box);
  return Promise.all(loads).then((oks) => {
    card.cap.textContent = oks.every(Boolean)
      ? `Shown with two <img> elements. Sizes: avatar ${card.imgs.avatar.naturalWidth} × ${card.imgs.avatar.naturalHeight}, name ${card.imgs.name.naturalWidth} × ${card.imgs.name.naturalHeight}.`
      : "An image did not load.";
    return oks.every(Boolean);
  });
}

function makeFrame(url, title, width, height) {
  const f = document.createElement("iframe");
  f.title = title;
  f.setAttribute("sandbox", "allow-scripts allow-same-origin");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.width = width; f.height = height;
  f.style.width = `${width}px`; f.style.height = `${height}px`;
  f.src = url;
  return f;
}

function loadFrame(card) {
  return new Promise((resolve) => {
    const f = makeFrame(bust(card.c.url), "Contact", 322, 90);
    f.onload = () => resolve(true);
    card.shot.replaceChildren(f);
    card.frame = f;
  }).then((ok) => { card.cap.textContent = "Shown with one <iframe>."; return ok; });
}

function buildCard(c, gridKey) {
  const el = document.createElement("section");
  el.className = `card ${c.kind}`;
  el.innerHTML = `
    <div class="head">
      <div class="kind">${esc(c.tag)}</div>
      <div class="title">${esc(c.title)}</div>
      <p class="note">${esc(c.note)}</p>
      ${c.knows ? `<div class="knows">The page knows: <code>${esc(c.knows)}</code></div>` : `<div class="url">${esc(c.url)}</div>`}
    </div>
    <div class="expect"><span>${expectText(c)}</span><span class="verdict">Not run</span></div>
    <div class="view">
      <div class="shot"></div>
      <div class="cap">Loading…</div>
      <div class="proofs"></div>
    </div>`;
  const proofs = el.querySelector(".proofs");
  const card = { c, el, results: {}, rows: {},
    shot: el.querySelector(".view > .shot"), cap: el.querySelector(".view > .cap"), verdict: el.querySelector(".verdict"),
    addProof(label, node) {
      const box = document.createElement("div");
      box.className = "proof";
      box.dataset.label = label;
      box.innerHTML = `<div class="cap">${esc(label)}:</div><div class="shot"></div>`;
      box.querySelector(".shot").appendChild(node);
      const old = [...proofs.children].find((b) => b.dataset.label === label);
      if (old) old.replaceWith(box); else proofs.appendChild(box);
    } };
  let group = null;
  for (const a of rowsFor(c)) {
    if (a.group && a.group !== group) {
      group = a.group;
      const g = document.createElement("div");
      g.className = "group";
      g.textContent = group;
      el.appendChild(g);
    }
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div><div class="name">${esc(a.name)}</div><code>${esc(a.code)}</code></div>
      <div class="right"><span class="pill">Not run</span><button type="button">Run</button></div><div class="out"></div>`;
    // prime() must run in the click handler, before any await, so the browser lets media play.
    row.querySelector("button").onclick = () => { if (a.prime) a.prime(card); runRow(card, a, row); };
    card.rows[a.key] = row;
    el.appendChild(row);
  }
  grids[gridKey].appendChild(el);
  cards[c.id] = card;
  card.ready = c.mode === "frame" ? loadFrame(card) : c.mode === "img" ? loadImages(card) : loadMedia(card);
}

function showResult(row, r) {
  const pill = row.querySelector(".pill"), out = row.querySelector(".out");
  row.className = `row ${r.status}`;
  pill.textContent = LABEL[r.status] || "Error";
  out.innerHTML = r.html; out.classList.add("show");
}

async function runRow(card, a, row) {
  await card.ready;
  row.querySelector(".pill").textContent = "…";
  const r = await a.run(card);
  card.results[a.key] = r.status;
  showResult(row, r);
  updateVerdict(card);
  return r.status;
}

function updateVerdict(card) {
  const list = rowsFor(card.c);
  const ran = list.filter((a) => card.results[a.key]);
  if (!ran.length) { card.verdict.textContent = "Not run"; card.verdict.className = "verdict"; return; }
  const m = ran.map((a) => matchRow(card.c, a, card.results[a.key]));
  const count = ran.length < list.length ? ` (${ran.length} of ${list.length} run)` : "";
  if (m.includes(false)) { card.verdict.textContent = `✗ Not as expected${count}`; card.verdict.className = "verdict bad"; }
  else if (m.includes("pending")) { card.verdict.textContent = `Waiting for the control${count}`; card.verdict.className = "verdict"; }
  else { card.verdict.textContent = `✓ As expected${count}`; card.verdict.className = "verdict ok"; }
}

// Section 2: contact list frame and messages.
let listFrame, msgCount = 0, msgLeak = false;
const pending = new Map();

function logMsg(dir, data) {
  const t = JSON.stringify(data);
  const leak = leaks(ALL_NAMES, t);
  msgCount++; msgLeak = msgLeak || leak;
  const log = document.getElementById("msgLog");
  log.textContent = `${dir}  ${t}${leak ? "   <- CONTAINS A NAME" : ""}\n` + log.textContent;
  const v = document.getElementById("msgVerdict");
  v.textContent = msgLeak ? "✗ A message contains a name" : `✓ ${msgCount} message(s), no names`;
  v.className = `verdict ${msgLeak ? "bad" : "ok"}`;
}

function buildList() {
  listFrame = makeFrame(LIST_URL, "Contact list", 360, 340);
  document.getElementById("listShot").replaceChildren(listFrame);
  document.getElementById("listUrl").textContent = LIST_URL;
  document.getElementById("msgLog").textContent = "";
  const v = document.getElementById("msgVerdict"); v.textContent = "No messages yet"; v.className = "verdict";
  msgCount = 0; msgLeak = false; pending.clear();
  const row = document.getElementById("listDomRow");
  row.className = "row"; row.querySelector(".pill").textContent = "Not run"; row.querySelector(".out").className = "out";
}

window.addEventListener("message", (event) => {
  if (!listFrame || event.source !== listFrame.contentWindow || event.origin !== HOST) return;
  const m = event.data;
  if (!m || m.app !== "host-demo" || m.v !== 1 || m.channel !== CHANNEL) return;
  if (m.type === "done") {
    if (pending.get(m.requestId) !== m.action) return;
    pending.delete(m.requestId);
  }
  logMsg("frame → page", m);
});

function sendCommand(action) {
  const m = { app: "host-demo", v: 1, channel: CHANNEL, type: "command", action, requestId: crypto.randomUUID().slice(0, 8) };
  pending.set(m.requestId, action);
  listFrame.contentWindow.postMessage(m, HOST);
  logMsg("page → frame", m);
}

document.getElementById("focusSearch").onclick = () => sendCommand("focus-search");
document.getElementById("clearSel").onclick = () => sendCommand("clear-selection");
document.querySelector("#listDomRow button").onclick = () =>
  showResult(document.getElementById("listDomRow"), readFrameDocument(listFrame, ALL_NAMES));

async function runAll() {
  window.__summary = null;
  const all = [...COMPARE, ...MEDIA, ...MORE];
  // Start media that needs a click now, before the first await.
  for (const c of all) for (const a of rowsFor(c)) if (a.prime) a.prime(cards[c.id]);
  for (const c of all) for (const a of rowsFor(c)) await runRow(cards[c.id], a, cards[c.id].rows[a.key]);
  const summary = {};
  for (const c of all) {
    updateVerdict(cards[c.id]);
    summary[c.id] = {};
    for (const a of rowsFor(c)) {
      const got = cards[c.id].results[a.key];
      summary[c.id][a.key] = { got, want: [expectedFor(c, a), ...((c.alt || {})[a.key] || [])].join("|"), ok: matchRow(c, a, got) === true };
    }
  }
  const lr = readFrameDocument(listFrame, ALL_NAMES);
  showResult(document.getElementById("listDomRow"), lr);
  summary.list = { dom: { got: lr.status, want: "blocked", ok: lr.status === "blocked" } };
  window.__summary = summary;
  return summary;
}

function build() {
  Object.values(grids).forEach((g) => g.replaceChildren());
  COMPARE.forEach((c) => buildCard(c, "compare"));
  MEDIA.forEach((c) => buildCard(c, "media"));
  MORE.forEach((c) => buildCard(c, "more"));
  buildList();
}

const heads = [...document.querySelectorAll("table.diff thead th")].map((th) => th.textContent);
document.querySelectorAll("table.diff tbody tr").forEach((tr) =>
  [...tr.children].forEach((td, i) => { if (i > 0 && td.colSpan === 1) td.dataset.label = heads[i]; }));
document.getElementById("pageOrigin").textContent = location.origin;
document.getElementById("hostOrigin").textContent = HOST;
document.getElementById("ua").textContent = navigator.userAgent;
document.getElementById("runAll").onclick = runAll;
document.getElementById("reset").onclick = build;
window.__runAll = runAll;
window.__messages = () => ({ count: msgCount, leak: msgLeak, log: document.getElementById("msgLog").textContent });
build();
