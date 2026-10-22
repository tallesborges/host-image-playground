// One script, deployed twice. ROLE selects the origin:
//   host:    owns the contact data. Serves the contact as images and as a frame.
//   product: the untrusted page with the tests. Knows only opaque aliases.
import { avatarPng } from "./avatars.js";
import { contactHtml, findContact, listHtml, nameSvg } from "./contacts.js";
import { listScript } from "./list-frame.js";

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

// /<prefix>/<alias>/avatar.png and /<prefix>/<alias>/name.svg
function contactImage(p, prefix, headers = {}) {
  const m = p.match(new RegExp(`^/${prefix}/([\\w-]+)/(avatar\\.png|name\\.svg)$`));
  if (!m) return null;
  const c = findContact(m[1]);
  return m[2] === "avatar.png" ? png(avatarPng(c.id), headers) : svg(nameSvg(c), headers);
}

function host(url, env) {
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

  // IMG idea: the page shows these images. No CORS header, so page JS cannot read them.
  if ((r = contactImage(p, "img"))) return r;

  // Control only: the same images with CORS allowed. Page JS can read them. Never do this with private data.
  if ((r = contactImage(p, "cors", { "access-control-allow-origin": "*" }))) return r;

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

function product(url, env) {
  const p = url.pathname;
  let r;
  if (p === "/config.js")
    return respond(`window.DEMO = ${JSON.stringify({ hostOrigin: env.HOST_ORIGIN })};\n`, "text/javascript; charset=utf-8");

  // Controls: the same contact from this page's own origin. Page JS must be able to read them.
  if ((r = contactImage(p, "same"))) return r;
  let m;
  if ((m = p.match(/^\/same-frame\/([\w-]+)$/))) return respond(contactHtml(findContact(m[1])), "text/html; charset=utf-8");
  if ((m = p.match(/^\/avatar\/([\w-]+)\.png$/))) return png(avatarPng(m[1]));

  // Static files (index.html, app.js, style.css) come from the assets binding before this Worker runs.
  return notFound();
}

export default {
  fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: COMMON });
    const url = new URL(request.url);
    if (env.ROLE === "host") return host(url, env);
    if (env.ROLE === "product") return product(url, env);
    return new Response("ROLE is not set", { status: 500 });
  },
};
