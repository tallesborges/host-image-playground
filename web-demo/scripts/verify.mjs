// Starts both Workers locally (or uses PRODUCT_URL and HOST_URL), runs the page in Chromium, Firefox, and WebKit, and checks
// that every test gives the expected result. Exits 0 only if all checks pass.
// Browsers: `npx playwright-core install chromium firefox webkit` once, if they are missing.
// Screenshots go to test-results/ (or $OUT).
import { mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright-core";
import * as local from "./local.mjs";

// Set PRODUCT_URL and HOST_URL to check a deployed demo instead of a local one.
const PRODUCT = process.env.PRODUCT_URL ?? local.PRODUCT;
const HOST = process.env.HOST_URL ?? local.HOST;

const OUT = process.env.OUT ?? new URL("../test-results/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function checkHeaders() {
  const get = (path) => fetch(HOST + path);
  for (const file of ["avatar.png", "name.svg"]) {
    const r = await get(`/img/c_7hq2m9/${file}`);
    check(r.status === 200 && !r.headers.has("access-control-allow-origin"), `host /img/<alias>/${file}: 200, no CORS header`);
    check((await get(`/cors/c_7hq2m9/${file}`)).headers.get("access-control-allow-origin") === "*", `host /cors/<alias>/${file} sends ACAO * (control)`);
  }
  check((await get("/img/c_7hq2m9/avatar.png")).headers.get("content-type") === "image/png", "avatar is image/png");
  const embed = (await get("/embed/contact?id=c_7hq2m9")).headers;
  check(embed.get("content-security-policy")?.includes(`frame-ancestors ${PRODUCT}`), "host /embed allows only the product origin as parent");
  check((await get("/avatar/c_7hq2m9.png")).headers.get("cross-origin-resource-policy") === "same-origin", "host /avatar sends CORP same-origin");
  check((await get("/embed/list.js")).headers.get("cross-origin-resource-policy") === "same-origin", "host /embed/list.js sends CORP same-origin");
  const script = await (await get("/embed/list.js")).text();
  check(!/Alice|Bob|Carol|Dan Demo|Eve Placeholder/.test(script), "list script has no contact data");

  // Unknown aliases must look like real ones: same status and same size.
  const pngSize = async (path) => {
    const r = await get(path);
    const b = new DataView(await r.arrayBuffer());
    return `${r.status} ${b.getUint32(16)}x${b.getUint32(20)}`;
  };
  const svgSize = async (path) => {
    const r = await get(path);
    return `${r.status} ${(await r.text()).match(/width="(\d+)" height="(\d+)"/).slice(1).join("x")}`;
  };
  const [pa, pu] = [await pngSize("/img/c_7hq2m9/avatar.png"), await pngSize("/img/unknown-alias/avatar.png")];
  check(pa === pu, `avatar: known and unknown alias give the same status and size (${pa} / ${pu})`);
  const [sa, su] = [await svgSize("/img/c_7hq2m9/name.svg"), await svgSize("/img/unknown-alias/name.svg")];
  check(sa === su, `name: known and unknown alias give the same status and size (${sa} / ${su})`);
}

async function runBrowser(type) {
  const browser = await type.launch();
  const name = `${type.name()} ${browser.version()}`;
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  // WebKit reports blocked cross-origin reads as page errors. Those are the expected result, not bugs.
  const expected = /access control checks|Protocols, domains, and ports must match|Cross-Origin Resource Sharing policy/;
  page.on("pageerror", (e) => { if (!expected.test(e.message)) errors.push(e.message); });
  await page.goto(PRODUCT);
  await page.waitForFunction(() => window.__runAll);
  await page.locator("#more").evaluate((d) => (d.open = true));
  const summary = await page.evaluate(() => window.__runAll());
  for (const [card, rows] of Object.entries(summary))
    for (const [row, { got, want }] of Object.entries(rows)) check(got === want, `${name}: ${card}/${row} = ${got} (want ${want})`);

  const list = page.frameLocator("#listShot iframe");
  await list.locator("#q").fill("ali");
  check((await list.locator("li:not([hidden])").count()) === 1, `${name}: search inside the frame shows 1 contact`);
  await list.getByText("Alice Example").click();
  await page.click("#focusSearch");
  await page.click("#clearSel");
  await page.waitForFunction(() => window.__messages().count >= 6, null, { timeout: 5000 }).catch(() => {});
  const msgs = await page.evaluate(() => window.__messages());
  check(msgs.count >= 6 && !msgs.leak, `${name}: ${msgs.count} messages, none with a name`);
  check(msgs.log.includes('"type":"select","id":"c_7hq2m9"'), `${name}: selection sent only the id`);
  check(errors.length === 0, `${name}: no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  const slug = type.name();
  await page.screenshot({ path: `${OUT}/${slug}-1300.png`, fullPage: true });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(PRODUCT);
  await phone.waitForFunction(() => window.__runAll);
  await phone.evaluate(() => window.__runAll());
  const sideScroll = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sideScroll <= 0, `${name}: no side scroll at 390 px (${sideScroll})`);
  await phone.screenshot({ path: `${OUT}/${slug}-390.png`, fullPage: true });
  await browser.close();
}

const { stop } = process.env.PRODUCT_URL ? { stop: async () => {} } : await local.startLocal();
console.log(`Product: ${PRODUCT}\nHost:    ${HOST}`);
try {
  await checkHeaders();
  for (const type of [chromium, firefox, webkit]) await runBrowser(type);
} catch (e) {
  failures.push(String(e && e.stack ? e.stack : e));
  console.error(e);
} finally {
  await stop();
}
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
