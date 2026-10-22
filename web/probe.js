'use strict';

// Untrusted "product" JS. It knows only aliases that the host gave to this product.
// SECRET and FILL are the test oracle: they tell the probe if private data reached JS.
// Keep in sync with HostContacts in shared/ (demo-product.dot aliases, Alice's color).
const OTHER_PRODUCT_ID = 'other-product.dot';
const ALIAS = 'a7f3k2';            // Alice, in demo-product.dot
const OTHER_CONTACT = 'm4q8z1';    // Bob, in demo-product.dot
const OTHER_PRODUCT = 'q2k9w5';    // Alice, in other-product.dot: must not resolve here
const MISSING = 'zzzz00';          // no contact
const SECRET = 'Alice Example';
const FILL = [10, 120, 200];       // Alice's color, at pixel (5, 24) in both images
const TIMEOUT_MS = 4000;

const SCENARIO =
  location.protocol === 'https:' ? 'https-page' :
  location.protocol === 'file:' ? 'file-page' : 'scheme-page';

const ALL_SOURCES = [
  { label: 'truapi-host://', fetchable: false, url: path => `truapi-host://${path}` },
  { label: 'https://host.test (virtual HTTPS)', fetchable: true, url: path => `https://host.test/${path}` },
];

// The two host resources: the name as SVG (text) and the avatar as PNG (raster).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const RESOURCES = [
  {
    label: 'name SVG', what: 'name',
    // Readable bytes leak the name itself.
    leaked: bytes => new TextDecoder().decode(bytes).includes(SECRET),
  },
  {
    label: 'avatar PNG', what: 'avatar',
    // Readable bytes are the private picture.
    leaked: bytes => bytes.length > 100 && PNG_MAGIC.every((b, i) => bytes[i] === b),
  },
];

const contactPath = (alias, what, q = '') => `contacts/${alias}/${what}${q}`;

// Optional native config, set before this script runs (iOS sets it with a WKUserScript):
//   sources:    labels to test (iOS cannot serve https://host.test)
//   fetchable:  per-label override of `fetchable`
//   beaconLog:  URL prefix for the beacon log
//   beaconHits: async id => [kinds], used instead of beaconLog (iOS: native bridge)
const CONFIG = self.PLAYGROUND_CONFIG || {};
const SOURCES = ALL_SOURCES
  .filter(s => !CONFIG.sources || CONFIG.sources.includes(s.label))
  .map(s => ({ ...s, fetchable: (CONFIG.fetchable || {})[s.label] ?? s.fetchable }));

const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nonce = () => Math.random().toString(36).slice(2, 10);

// Adds ?trace=<id>. The host logs each trace id it receives, so the page can tell
// "the engine refused the request" (not reached) from "the host answered, then the
// engine blocked the read" (reached).
function traced(url) {
  const id = 't' + nonce();
  return { id, url: url + (url.includes('?') ? '&' : '?') + 'trace=' + id };
}

async function reached(id) {
  const hits = await beaconHits(id);
  if (hits.error) return { reached: null, text: 'handler: unknown (' + hits.error + ')' };
  return hits.length
    ? { reached: true, text: 'handler: reached' }
    : { reached: false, text: 'handler: not reached (engine refused the request)' };
}

function timeout(p, ms = TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

function errText(e) {
  if (!e) return 'error';
  return (e.name ? e.name + ': ' : '') + (e.message || String(e));
}

// want: 'show' | 'block' | 'read' (control)
// outcome: 'shown' | 'not shown' | 'READ' | 'blocked' | 'n/a'
function record(source, probe, want, outcome, detail, extra = {}) {
  let ok;
  if (want === 'show') ok = outcome === 'shown';
  else if (want === 'block') ok = outcome !== 'READ';
  else ok = outcome === 'READ';
  const r = {
    scenario: SCENARIO,
    origin: self.origin,
    source, probe, want, outcome, ok,
    detail: String(detail ?? '').slice(0, 300),
    ...extra,
  };
  results.push(r);
  console.log('RESULT ' + JSON.stringify(r));
  render(r);
}

let lastGroup = '';
function render(r) {
  const box = document.getElementById('results');
  if (r.source !== lastGroup) {
    lastGroup = r.source;
    const g = document.createElement('div');
    g.className = 'group';
    g.textContent = r.source;
    box.appendChild(g);
  }
  let tag, cls;
  if (r.want === 'show') { tag = r.ok ? 'Shown' : 'Not shown'; cls = r.ok ? 'safe' : 'leak'; }
  else if (r.want === 'block') { tag = r.ok ? 'Safe' : 'Leak'; cls = r.ok ? 'safe' : 'leak'; }
  else { tag = r.ok ? 'Control: read' : 'Control: no read'; cls = 'ctl'; }
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span class="probe"></span><span class="tag ' + cls + '"></span><span class="detail"></span>';
  row.children[0].textContent = r.probe;
  row.children[1].textContent = tag;
  row.children[2].textContent = r.outcome + (r.detail ? ' · ' + r.detail : '');
  box.appendChild(row);
}

function loadImg(url, crossOrigin) {
  return timeout(new Promise((res, rej) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('img error event'));
    img.src = url;
  }));
}

// What a real product UI shows: avatar and name side by side. Empty alt: no private alt text.
function showContact(label, avatar, name) {
  const fig = document.createElement('figure');
  fig.className = 'contact';
  for (const img of [avatar, name]) {
    if (img) {
      const copy = img.cloneNode();
      copy.alt = '';
      fig.appendChild(copy);
    } else {
      const m = document.createElement('div');
      m.className = 'missing';
      m.textContent = 'Not shown';
      fig.appendChild(m);
    }
  }
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  fig.appendChild(cap);
  document.getElementById('shown').appendChild(fig);
}

function draw(src) {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 64;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function pixelOf(src) {
  const d = draw(src).getContext('2d').getImageData(5, 24, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function pixelProbe(src) {
  const px = pixelOf(src);
  const match = px[0] === FILL[0] && px[1] === FILL[1] && px[2] === FILL[2];
  return 'pixel=' + px.join(',') + (match ? ' (matches Alice color)' : ' (no match)');
}

async function canvasProbes(source, img, prefix, want, why = '') {
  if (!img) {
    record(source, prefix + 'getImageData', want, 'n/a', 'image did not load ' + why);
    record(source, prefix + 'toDataURL', want, 'n/a', 'image did not load ' + why);
    return;
  }
  try { record(source, prefix + 'getImageData', want, 'READ', pixelProbe(img)); }
  catch (e) { record(source, prefix + 'getImageData', want, 'blocked', errText(e)); }
  try {
    const s = draw(img).toDataURL('image/png');
    record(source, prefix + 'toDataURL', want, 'READ', 'length=' + s.length);
  } catch (e) { record(source, prefix + 'toDataURL', want, 'blocked', errText(e)); }
}

async function fetchProbe(source, probe, url, opts, want, leaked) {
  const t = traced(url);
  let outcome, detail;
  try {
    const r = await timeout(fetch(t.url, opts));
    const bytes = new Uint8Array(await r.arrayBuffer());
    outcome = leaked(bytes) ? 'READ' : 'blocked';
    detail = `type=${r.type} status=${r.status} bytes=${bytes.length}`;
  } catch (e) {
    outcome = 'blocked';
    detail = errText(e);
  }
  const h = await reached(t.id);
  record(source, probe, want, outcome, `${detail} · ${h.text}`, { reached: h.reached });
}

async function xhrProbe(source, probe, url, leaked) {
  const t = traced(url);
  const [outcome, detail] = await timeout(new Promise(res => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', t.url);
      x.responseType = 'arraybuffer';
      x.onload = () => {
        const bytes = new Uint8Array(x.response || new ArrayBuffer(0));
        res([leaked(bytes) ? 'READ' : 'blocked', `status=${x.status} bytes=${bytes.length}`]);
      };
      x.onerror = () => res(['blocked', 'xhr error event']);
      x.send();
    } catch (e) {
      res(['blocked', errText(e)]);
    }
  })).catch(e => ['blocked', errText(e)]);
  const h = await reached(t.id);
  record(source, probe, 'block', outcome, `${detail} · ${h.text}`, { reached: h.reached });
}

// Two results per frame: did the host frame load, and could the page read its DOM.
// A DOM read only counts as isolation when the frame loaded; otherwise it is 'n/a'.
function frameProbe(source, url, sandbox) {
  const kind = sandbox ? 'iframe sandbox="' + sandbox + '"' : 'iframe';
  const t = traced(url);
  return new Promise(res => {
    const fig = document.createElement('figure');
    fig.style.margin = '0';
    const f = document.createElement('iframe');
    if (sandbox) f.setAttribute('sandbox', sandbox);
    let loaded = false, done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      const h = await reached(t.id);
      // Cross-origin frames fire 'load' too, so 'load' plus a host hit means the host page loaded.
      const shown = loaded && h.reached !== false;
      record(source, kind + ' loads', 'show', shown ? 'shown' : 'not shown',
        `load event=${loaded} · ${h.text}`, { reached: h.reached });
      let outcome, detail;
      if (!shown) {
        outcome = 'n/a';
        detail = 'frame did not load: DOM isolation not tested';
      } else {
        try {
          const doc = f.contentWindow.document;
          const text = doc && doc.body ? doc.body.innerText : '';
          outcome = text.includes(SECRET) ? 'READ' : 'blocked';
          detail = `doc.URL=${doc.URL} text=${JSON.stringify(text.slice(0, 40))}`;
        } catch (e) {
          outcome = 'blocked';
          detail = errText(e);
        }
      }
      record(source, kind + ' DOM read', 'block', outcome, detail, { reached: h.reached });
      res();
    };
    f.onload = () => { loaded = true; setTimeout(finish, 300); };
    setTimeout(finish, TIMEOUT_MS);
    f.src = t.url;
    const cap = document.createElement('figcaption');
    cap.textContent = source + ' · ' + kind;
    fig.appendChild(f);
    fig.appendChild(cap);
    document.getElementById('frames').appendChild(fig);
  });
}

// All probes for one resource (name SVG or avatar PNG) on one source.
async function runResource(s, res) {
  const p = name => `${res.label}: ${name}`;
  const url = s.url(contactPath(ALIAS, res.what));

  // 1. Display: the host image must render for the user.
  let img = null;
  try {
    img = await loadImg(url);
    record(s.label, p('<img> display'), 'show', 'shown', `${img.naturalWidth}x${img.naturalHeight}`);
  } catch (e) {
    record(s.label, p('<img> display'), 'show', 'not shown', errText(e));
  }
  if (img) {
    try { await timeout(img.decode()); record(s.label, p('img.decode()'), 'show', 'shown', 'resolved'); }
    catch (e) { record(s.label, p('img.decode()'), 'show', 'not shown', errText(e)); }
  }

  // 2. Byte reads.
  await fetchProbe(s.label, p('fetch()'), url, undefined, 'block', res.leaked);
  await fetchProbe(s.label, p("fetch({mode:'no-cors'})"), url, { mode: 'no-cors' }, 'block', res.leaked);
  await xhrProbe(s.label, p('XHR GET'), url, res.leaked);

  // 3. Pixel reads from a plain <img>.
  await canvasProbes(s.label, img, p('canvas '), 'block');
  try {
    const bmp = await timeout(createImageBitmap(img || new Image()));
    try { record(s.label, p('createImageBitmap → getImageData'), 'block', 'READ', pixelProbe(bmp)); }
    catch (e) { record(s.label, p('createImageBitmap → getImageData'), 'block', 'blocked', errText(e)); }
  } catch (e) {
    record(s.label, p('createImageBitmap → getImageData'), 'block', 'blocked', errText(e));
  }

  // 4. crossOrigin="anonymous" without CORS header from the host.
  let corsImg = null, why = '';
  try { corsImg = await loadImg(url, 'anonymous'); } catch (e) { why = errText(e); }
  await canvasProbes(s.label, corsImg, p('crossOrigin (no ACAO) canvas '), 'block', why);

  // 5. Controls: host opts in with Access-Control-Allow-Origin: *.
  //    If these read, the host header alone decides readability.
  const corsUrl = s.url(contactPath(ALIAS, res.what, '?cors=1'));
  let optIn = null, optWhy = '';
  try { optIn = await loadImg(corsUrl, 'anonymous'); } catch (e) { optWhy = errText(e); }
  await canvasProbes(s.label, optIn, p('control: ACAO * canvas '), 'read', optWhy);
  // Android: fetch() supports only http(s)/data/blob, so a custom scheme fails even with ACAO.
  await fetchProbe(s.label, s.fetchable ? p('control: ACAO * fetch()') : p('ACAO * fetch() (scheme)'),
    corsUrl, undefined, s.fetchable ? 'read' : 'block', res.leaked);

  // 6. Product scope. With ACAO the page can read pixels, so it can tell what the host
  //    returned. An alias from another product must give the placeholder, even if the URL
  //    claims that product.
  for (const [name, q] of [
    ['alias from another product', '?cors=1'],
    ['alias from another product, URL claims that product', '?cors=1&product=' + OTHER_PRODUCT_ID],
  ]) {
    try {
      const other = await loadImg(s.url(contactPath(OTHER_PRODUCT, res.what, q)), 'anonymous');
      const px = pixelOf(other);
      const real = px[0] === FILL[0] && px[1] === FILL[1] && px[2] === FILL[2];
      record(s.label, p(name), 'block', real ? 'READ' : 'blocked',
        `pixel=${px.join(',')} ${real ? '(Alice color: resolved)' : '(placeholder)'}`);
    } catch (e) {
      record(s.label, p(name), 'block', 'n/a', 'could not read pixels: ' + errText(e));
    }
  }

  // 7. Size and load/error per alias. The bad host ('leaky-*') is the control.
  await sizeAndEventProbes(s, res);
  return img;
}

const SIDE_ALIASES = [ALIAS, OTHER_CONTACT, MISSING, OTHER_PRODUCT];

async function imgFacts(urls) {
  return Promise.all(urls.map(async u => {
    try { const i = await loadImg(u); return { ev: 'load', size: `${i.naturalWidth}x${i.naturalHeight}` }; }
    catch (e) { return { ev: 'error', size: '-' }; }
  }));
}

function differs(list) { return new Set(list).size > 1; }

async function sizeAndEventProbes(s, res) {
  const p = name => `${res.label}: ${name}`;
  const safe = await imgFacts(SIDE_ALIASES.map(a => s.url(contactPath(a, res.what))));
  const bad = await imgFacts(SIDE_ALIASES.map(a => s.url(contactPath(a, 'leaky-' + res.what))));
  const show = f => SIDE_ALIASES.map((a, i) => `${a} ${f[i].ev} ${f[i].size}`).join(', ');
  const sizes = f => f.filter(x => x.ev === 'load').map(x => x.size);
  const evs = f => f.map(x => x.ev);
  record(s.label, p('size differs per alias'), 'block', differs(sizes(safe)) ? 'READ' : 'blocked', show(safe));
  record(s.label, p('load/error differs per alias'), 'block', differs(evs(safe)) ? 'READ' : 'blocked', show(safe));
  record(s.label, p('control: bad host size'), 'read', differs(sizes(bad)) ? 'READ' : 'blocked', show(bad));
  record(s.label, p('control: bad host load/error'), 'read', differs(evs(bad)) ? 'READ' : 'blocked', show(bad));
}

const BEACON_LOG = id => (CONFIG.beaconLog || 'https://host.test/beacon-log/') + id;

async function beaconHits(id) {
  try {
    if (CONFIG.beaconHits) return await timeout(CONFIG.beaconHits(id));
    return await (await timeout(fetch(BEACON_LOG(id)))).json();
  }
  catch (e) { return { error: errText(e) }; }
}

async function svgScriptProbe(s) {
  const imgId = 'img' + nonce();
  const docId = 'doc' + nonce();
  let shown = false;
  try {
    await loadImg(s.url('probe/' + imgId));
    shown = true;
  } catch (e) { /* reported in detail */ }
  const f = document.createElement('iframe');
  f.style.cssText = 'width:130px;height:44px;border:0';
  f.src = s.url('probe/' + docId);
  document.getElementById('frames').appendChild(f);
  await sleep(1500);
  const imgHits = await beaconHits(imgId);
  const docHits = await beaconHits(docId);
  // A broken beacon log gives 'n/a', so the control fails and the run fails.
  const outcome = hits => hits.error ? 'n/a' : hits.length ? 'READ' : 'blocked';
  record(s.label, 'SVG <img> runs script or loads URLs', 'block', outcome(imgHits),
    `img loaded=${shown} hits=${JSON.stringify(imgHits)}`);
  record(s.label, 'control: same SVG as iframe document', 'read', outcome(docHits),
    `hits=${JSON.stringify(docHits)}`);
}

async function runSource(s) {
  const imgs = [];
  for (const res of RESOURCES) imgs.push(await runResource(s, res));
  showContact(s.label, imgs[1], imgs[0]);

  // Frames, plain and with the provider sandbox flags.
  const frame = s.url(contactPath(ALIAS, 'frame'));
  await frameProbe(s.label, frame, '');
  await frameProbe(s.label, frame, 'allow-scripts allow-same-origin');

  await svgScriptProbe(s);
}

async function findProbe() {
  const label = 'whole page';
  if (typeof window.find !== 'function') {
    record(label, 'window.find(name)', 'block', 'n/a', 'window.find not available');
    return;
  }
  const find = () => {
    getSelection().removeAllRanges();
    const found = window.find(SECRET, false, false, true);
    getSelection().removeAllRanges();
    return found;
  };
  // At this point the page shows the host images and host iframes with the name.
  record(label, 'window.find(name) over images and iframes', 'block', find() ? 'READ' : 'blocked', '');
  const para = document.createElement('p');
  para.textContent = SECRET;
  document.body.appendChild(para);
  const found = find();
  para.remove();
  record(label, 'control: name as page text', 'read', found ? 'READ' : 'blocked', '');
}

async function runOwnControl() {
  const label = 'own origin (control)';
  let img = null, why = '';
  try { img = await loadImg('own.svg'); } catch (e) { why = errText(e); }
  await canvasProbes(label, img, 'canvas ', 'read', why);
}

async function run() {
  const engine = (navigator.userAgent.match(/Chrome\/[\d.]+|AppleWebKit\/[\d.]+/) || ['?'])[0];
  // A file:// page shows only the end of its path: the rest is a local folder.
  const page = location.protocol === 'file:'
    ? 'file://…/' + location.pathname.split('/').slice(-3).join('/')
    : location.href;
  document.getElementById('meta').textContent =
    `page ${page} · origin ${self.origin} · ${engine} · secure=${self.isSecureContext}`;
  console.log('META ' + JSON.stringify({
    scenario: SCENARIO, href: location.href, origin: self.origin,
    secure: self.isSecureContext, ua: navigator.userAgent,
  }));

  for (const s of SOURCES) await runSource(s);
  await runOwnControl();
  await findProbe();
  scrollTo(0, 0); // window.find scrolls to its match; show the contact again.

  const leaks = results.filter(r => r.want === 'block' && !r.ok).length;
  const notShown = results.filter(r => r.want === 'show' && !r.ok).length;
  const controlsFailed = results.filter(r => r.want === 'read' && !r.ok).length;
  const text = `Leaks: ${leaks} · Display failures: ${notShown} · Controls without read: ${controlsFailed}`;
  document.getElementById('summary').textContent = text;
  console.log('DONE ' + JSON.stringify({ scenario: SCENARIO, leaks, notShown, controlsFailed, total: results.length }));
}

run().catch(e => console.log('FATAL ' + errText(e)));
