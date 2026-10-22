// One script, deployed twice. ROLE selects the origin:
//   host:    owns the contact data. Serves the contact as images and as a frame.
//   product: the untrusted page with the tests. Knows only opaque aliases.
import { avatarPng } from "./avatars.js";
import { contactHtml, findContact, listHtml, nameSvg } from "./contacts.js";
import { listScript } from "./list-frame.js";
import { mediaFile } from "./media.js";

const COMMON = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// An SVG opened as a document must not run anything.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

function respond(body, type, headers = {}) {
  return new Response(body, { headers: { "content-type": type, ...COMMON, ...headers } });
}

const svg = (body, headers = {}) => respond(body, "image/svg+xml", { "content-security-policy": SVG_CSP, ...headers });
const png = (bytes, headers = {}) => respond(bytes, "image/png", headers);
const notFound = () => new Response("Not found", { status: 404, headers: COMMON });

// Media elements load with Range requests. WebKit does not play video without 206 responses.
function ranged(request, bytes, type, headers) {
  const size = bytes.byteLength;
  const base = { "content-type": type, "accept-ranges": "bytes", ...COMMON, ...headers };
  const range = request.headers.get("range");
  const body = (b) => (request.method === "HEAD" ? null : b);
  if (!range) return new Response(body(bytes), { headers: { ...base, "content-length": String(size) } });
  const m = range.match(/^bytes=(\d*)-(\d*)$/);
  let start = m && m[1] !== "" ? Number(m[1]) : NaN;
  let end = m && m[2] !== "" ? Number(m[2]) : size - 1;
  if (m && m[1] === "" && m[2] !== "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  if (!m || Number.isNaN(start) || start >= size || end < start)
    return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  end = Math.min(end, size - 1);
  return new Response(body(bytes.slice(start, end + 1)), {
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

// /<prefix>/<alias>/avatar.png, name.svg, clip.webm, clip.mp4, tone.wav
function contactFile(request, p, prefix, headers = {}) {
  const m = p.match(new RegExp(`^/${prefix}/([\\w-]+)/([\\w.]+)$`));
  if (!m) return null;
  const c = findContact(m[1]);
  if (m[2] === "avatar.png") return png(avatarPng(c.id), headers);
  if (m[2] === "name.svg") return svg(nameSvg(c), headers);
  const media = mediaFile(c.id, m[2]);
  return media ? ranged(request, media.bytes, media.type, headers) : null;
}

const CORS = { "access-control-allow-origin": "*" };

function host(request, url, env) {
  const p = url.pathname;
  let r;
  const frameCsp = (script) =>
    [
      "default-src 'none'",
      script ? "script-src 'self'" : null,
      "style-src 'unsafe-inline'",
      "img-src 'self'",
      `frame-ancestors ${env.PRODUCT_ORIGIN}`,
      "base-uri 'none'",
      "form-action 'none'",
    ]
      .filter(Boolean)
      .join("; ");

  // IMG idea: the page shows these images, videos, and audio. No CORS header, so page JS cannot read them.
  if ((r = contactFile(request, p, "img"))) return r;

  // Control only: the same files with CORS allowed. Page JS can read them. Never do this with private data.
  if ((r = contactFile(request, p, "cors", CORS))) return r;

  // iframe idea: the contact and the list as documents. Only the product origin can embed them.
  if (p === "/embed/contact")
    return respond(contactHtml(findContact(url.searchParams.get("id"))), "text/html; charset=utf-8", {
      "content-security-policy": frameCsp(false),
    });
  if (p === "/embed/list")
    return respond(listHtml(), "text/html; charset=utf-8", { "content-security-policy": frameCsp(true) });
  if (p === "/embed/list.js")
    return respond(listScript(env.PRODUCT_ORIGIN), "text/javascript; charset=utf-8", {
      "cross-origin-resource-policy": "same-origin",
    });

  // Avatars for the frames. Other origins cannot show them.
  const m = p.match(/^\/avatar\/([\w-]+)\.png$/);
  if (m) return png(avatarPng(m[1]), { "cross-origin-resource-policy": "same-origin" });

  if (p === "/")
    return respond(
      `This origin is the host side of the host image demo. Open ${env.PRODUCT_ORIGIN} to run the tests.\n`,
      "text/plain; charset=utf-8",
    );
  return notFound();
}

function product(request, url, env) {
  const p = url.pathname;
  let r;
  if (p === "/config.js")
    return respond(`window.DEMO = ${JSON.stringify({ hostOrigin: env.HOST_ORIGIN })};\n`, "text/javascript; charset=utf-8");

  // Controls: the same contact from this page's own origin. Page JS must be able to read them.
  if ((r = contactFile(request, p, "same"))) return r;
  let m;
  if ((m = p.match(/^\/same-frame\/([\w-]+)$/))) return respond(contactHtml(findContact(m[1])), "text/html; charset=utf-8");
  if ((m = p.match(/^\/avatar\/([\w-]+)\.png$/))) return png(avatarPng(m[1]));

  // Static files (index.html, app.js, style.css) come from the assets binding before this Worker runs.
  return notFound();
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    // CORS preflight, for the control files only. A media request with crossOrigin can send a Range header.
    if (request.method === "OPTIONS" && env.ROLE === "host" && url.pathname.startsWith("/cors/"))
      return new Response(null, {
        status: 204,
        headers: { ...CORS, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": "range", ...COMMON },
      });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: COMMON });
    if (env.ROLE === "host") return host(request, url, env);
    if (env.ROLE === "product") return product(request, url, env);
    return new Response("ROLE is not set", { status: 500 });
  },
};
