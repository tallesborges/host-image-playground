"use strict";

// Video and audio checks. Loaded before app.js. The functions here use helpers from app.js
// (esc, bust, errText, judgeBody, cards) only when they run, not when this file loads.

// The known signals in the synthetic media (see scripts/make-media.mjs).
const VIDEO_SIGNAL = { left: [220, 40, 40], right: [40, 80, 220], tolerance: 60 };
const TONE_HZ = 440;

const MEDIA_LABEL = {
  zero: "Only zeros", visible: "Visible", noplay: "Did not play", unsupported: "Not supported",
};

let audioCtx = null;
function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p, ms, what) =>
  Promise.race([p, sleep(ms).then(() => { throw Object.assign(new Error(`${what} timed out after ${ms} ms`), { name: "TimeoutError" }); })]);

function mediaSources(base, kind) {
  return kind === "video"
    ? [{ url: `${base}/clip.mp4`, type: "video/mp4" }, { url: `${base}/clip.webm`, type: "video/webm" }]
    : [{ url: `${base}/tone.wav`, type: "audio/wav" }];
}

function newMediaElement(card, { muted, controls } = {}) {
  const el = document.createElement(card.c.mode);
  if (card.c.crossOrigin) el.crossOrigin = card.c.crossOrigin;
  el.preload = "auto";
  el.playsInline = true;
  el.muted = !!muted;
  el.controls = !!controls;
  for (const s of card.c.sources) {
    const src = document.createElement("source");
    src.src = bust(s.url);
    src.type = s.type;
    el.appendChild(src);
  }
  return el;
}

// Resolves when the element has a current frame or sample, or with an error status.
function whenLoaded(el) {
  return new Promise((resolve) => {
    if (el.readyState >= 2) return resolve({ ok: true });
    const done = (r) => { clearTimeout(t); resolve(r); };
    const t = setTimeout(() => done({ ok: false, status: "error", why: `No data after 8 s (readyState ${el.readyState}).` }), 8000);
    el.addEventListener("loadeddata", () => done({ ok: true }), { once: true });
    const last = el.querySelector("source:last-of-type") || el;
    last.addEventListener("error", () => done({ ok: false, status: "unsupported", why: "No source plays in this browser." }), { once: true });
    el.addEventListener("error", () => done({ ok: false, status: "unsupported", why: `Media error ${el.error && el.error.code}: ${el.error && el.error.message}` }), { once: true });
  });
}

const srcName = (el) => (el.currentSrc ? new URL(el.currentSrc).pathname.split("/").pop() : "none");
const fileOf = (card) => card.media && card.media.currentSrc
  ? { type: card.media.currentSrc.includes(".wav") ? "wav" : card.media.currentSrc.includes(".mp4") ? "mp4" : "webm", url: card.media.currentSrc.split("?")[0], label: srcName(card.media) }
  : null;

function loadMedia(card) {
  // Video starts muted, so the browser lets it play without a click. Audio waits for the user.
  const el = newMediaElement(card, { muted: card.c.mode === "video", controls: true });
  if (card.c.mode === "video") { el.width = 160; el.height = 90; el.loop = true; }
  card.media = el;
  card.events = [];
  for (const ev of ["loadedmetadata", "loadeddata", "canplay", "play", "playing", "timeupdate", "ended", "error"])
    el.addEventListener(ev, () => { if (!card.events.includes(ev)) card.events.push(ev); });
  card.shot.replaceChildren(el);
  return whenLoaded(el).then(async (r) => {
    card.loadResult = r;
    if (!r.ok) { card.cap.textContent = r.why; return false; }
    const size = card.c.mode === "video" ? `, ${el.videoWidth} × ${el.videoHeight}` : "";
    card.cap.textContent = `Shown with <${card.c.mode}>. File ${srcName(el)}, ${el.duration.toFixed(1)} s${size}.`;
    if (card.c.mode === "video") { try { await el.play(); } catch {} }
    return true;
  });
}

// Wraps a check: it needs a loaded element.
function needsMedia(run) {
  return async (card) => {
    await card.ready;
    if (!card.loadResult || !card.loadResult.ok) return { status: card.loadResult ? card.loadResult.status : "error", html: esc(card.loadResult ? card.loadResult.why : "Not loaded.") };
    return run(card);
  };
}

const MEDIA_SIG = {
  webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  mp4: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  wav: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57,
};

// Did the page get the file? A real file starts with the format signature.
function judgeMedia(file, buf) {
  const b = new Uint8Array(buf);
  const ok = b.length > 12 && MEDIA_SIG[file.type](b);
  return { status: ok ? "read" : "blocked", detail: ok ? `body=${b.length} bytes of ${file.type.toUpperCase()} data` : `body=${b.length} bytes` };
}

const MEDIA_NET = [
  { key: "fetch", name: "Read the file with fetch", code: "await (await fetch(media.currentSrc)).arrayBuffer()",
    run: needsMedia(async (card) => {
      const f = fileOf(card);
      try {
        const r = await fetch(bust(f.url)); const j = judgeMedia(f, await r.arrayBuffer());
        return { status: j.status, html: `${f.label}: type=${r.type} status=${r.status} ${j.detail}` };
      } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
    }) },
  { key: "xhr", name: "Read the file with XHR", code: "xhr.responseType = 'arraybuffer'; xhr.response",
    run: needsMedia((card) => new Promise((resolve) => {
      const f = fileOf(card);
      const x = new XMLHttpRequest(); x.open("GET", bust(f.url)); x.responseType = "arraybuffer";
      const done = (ev) => {
        const j = judgeMedia(f, x.response || new ArrayBuffer(0));
        resolve({ status: j.status, html: `${f.label}: event=${ev} status=${x.status} ${j.detail}` });
      };
      x.onload = () => done("load"); x.onerror = () => done("error"); x.send();
    })) },
  { key: "nocors", name: "Read the file with a no-cors fetch", code: "await (await fetch(url, {mode:'no-cors'})).arrayBuffer()",
    run: needsMedia(async (card) => {
      const f = fileOf(card);
      try {
        const r = await fetch(bust(f.url), { mode: "no-cors" }); const j = judgeMedia(f, await r.arrayBuffer());
        return { status: j.status, html: `${f.label}: type=${r.type} status=${r.status} ${j.detail}` };
      } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
    }) },
];

// What the page can always see about a media element. Same for a known and an unknown alias here,
// because the placeholder has the same size and duration.
const MEDIA_VISIBLE = { key: "visible", expectAlways: "visible", name: "What the page can see anyway", code: "duration, videoWidth, currentTime, events",
  run: needsMedia(async (card) => {
    const el = card.media;
    const t0 = el.currentTime; await sleep(300); const t1 = el.currentTime;
    const size = card.c.mode === "video" ? `videoWidth × videoHeight: ${el.videoWidth} × ${el.videoHeight}\n` : "";
    return { status: "visible", html: `duration: ${el.duration.toFixed(2)} s\n${size}currentTime: ${t0.toFixed(2)} → ${t1.toFixed(2)} s\nevents: ${card.events.join(", ")}\nThe browser always shows these to the page. The host must keep them the same for all contacts.` };
  }) };

function frameColors(ctx) {
  const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  return { left: at(40, 45), right: at(120, 45) };
}
const near = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
function judgeFrame(colors) {
  const ok = near(colors.left, VIDEO_SIGNAL.left, VIDEO_SIGNAL.tolerance) && near(colors.right, VIDEO_SIGNAL.right, VIDEO_SIGNAL.tolerance);
  const zero = colors.left.every((v) => v === 0) && colors.right.every((v) => v === 0);
  return { status: ok ? "read" : zero ? "zero" : "read", note: `left=rgb(${colors.left}) right=rgb(${colors.right})${ok ? ", the known red and blue" : zero ? ", black" : ", other content"}` };
}

function drawVideo(card) {
  const cv = document.createElement("canvas");
  cv.width = 160; cv.height = 90;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(card.media, 0, 0, cv.width, cv.height);
  return { cv, ctx };
}

const VIDEO_PIXELS = { key: "pixels", name: "Read a frame's pixels", code: "ctx.drawImage(video, 0, 0); ctx.getImageData(...)",
  run: needsMedia(async (card) => {
    let cv, ctx;
    try { ({ cv, ctx } = drawVideo(card)); } catch (e) { return { status: "error", html: `drawImage error: ${esc(errText(e))}` }; }
    try {
      const j = judgeFrame(frameColors(ctx));
      card.addProof("Video frame: pixels that the page read (copy)", cv);
      return { status: j.status, html: `Got pixels: ${j.note}. The copy is below.` };
    } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
  }) };

const VIDEO_EXPORT = { key: "export", name: "Export a frame", code: "canvas.toDataURL()",
  run: needsMedia(async (card) => {
    let cv;
    try { ({ cv } = drawVideo(card)); } catch (e) { return { status: "error", html: `drawImage error: ${esc(errText(e))}` }; }
    try {
      const u = cv.toDataURL("image/png");
      card.addProof("Video frame: image that the page exported", Object.assign(new Image(), { src: u, width: 160, height: 90 }));
      return { status: "read", html: `Got a PNG data URL (${u.length} chars). The exported copy is below.` };
    } catch (e) { return { status: "blocked", html: `Error: ${esc(errText(e))}` }; }
  }) };

const VIDEO_WEBCODECS = { key: "webcodecs", name: "Read a frame with WebCodecs", code: "new VideoFrame(video).copyTo(buffer)",
  run: needsMedia(async (card) => {
    if (typeof VideoFrame === "undefined") return { status: "na", html: "This browser has no VideoFrame." };
    let frame;
    try { frame = new VideoFrame(card.media, { timestamp: 0 }); }
    catch (e) { return { status: e && e.name === "SecurityError" ? "blocked" : "error", html: `Throws ${esc(errText(e))}` }; }
    try {
      const buf = new Uint8Array(frame.allocationSize());
      await frame.copyTo(buf);
      const nonzero = buf.some((v) => v !== 0);
      return { status: nonzero ? "read" : "zero", html: `Got ${buf.length} bytes (${frame.format}, ${frame.codedWidth} × ${frame.codedHeight})${nonzero ? "" : ", all zero"}.` };
    } catch (e) { return { status: "blocked", html: `copyTo: ${esc(errText(e))}` }; }
    finally { frame.close(); }
  }) };

// Reads a video track from a MediaStream into a canvas.
async function readStreamFrame(stream) {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  await timeout(v.play(), 4000, "play()");
  await timeout(new Promise((r) => (v.readyState >= 2 ? r() : v.addEventListener("loadeddata", r, { once: true }))), 4000, "loadeddata");
  await sleep(200);
  const cv = document.createElement("canvas"); cv.width = 160; cv.height = 90;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, 160, 90);
  try { return { colors: frameColors(ctx), cv }; } finally { v.srcObject = null; }
}

const captureOf = (el) => (el.captureStream ? el.captureStream() : el.mozCaptureStream ? el.mozCaptureStream() : undefined);
const CAPTURE_CODE = "media.captureStream() (Firefox: mozCaptureStream)";

const VIDEO_CAPTURE = { key: "capture", name: "Capture the video as a stream", code: CAPTURE_CODE,
  run: needsMedia(async (card) => {
    if (!card.media.captureStream && !card.media.mozCaptureStream) return { status: "na", html: "This browser has no captureStream on media elements." };
    let stream;
    try { stream = captureOf(card.media); } catch (e) { return { status: "blocked", html: `Throws ${esc(errText(e))}` }; }
    try {
      if (!stream.getVideoTracks().length) await sleep(300);
      if (!stream.getVideoTracks().length) return { status: "blocked", html: "The stream has no video track." };
      const { colors, cv } = await readStreamFrame(stream);
      const j = judgeFrame(colors);
      card.addProof("Video frame from the stream (copy)", cv);
      return { status: j.status, html: `Got pixels from the stream: ${j.note}.` };
    } catch (e) { return { status: e && e.name === "SecurityError" ? "blocked" : "error", html: `${esc(errText(e))}` }; }
    finally { stream && stream.getTracks().forEach((t) => t.stop()); }
  }) };

// Audio: play a separate element through Web Audio and look at the samples.
// The element must start in the click handler, so prime() runs before any await.
function primeAudio(card, key, makeNode) {
  // The Web Audio path goes to a 0 gain, so the user hears nothing. For the capture, volume 0 keeps it
  // quiet; muted is not used, because Firefox then captures silence even from a same-origin file.
  const el = newMediaElement(card);
  if (key === "capture") el.volume = 0;
  el.loop = true; // "Run all" reaches this row a few seconds after the click.
  el.style.display = "none";
  document.body.appendChild(el);
  const ctx = getAudioContext();
  const state = { el, ctx, play: null, node: null, err: null, stream: null, captureErr: null };
  try {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
    if (makeNode === "element" && ctx) state.node = ctx.createMediaElementSource(el);
  } catch (e) { state.err = e; }
  state.play = el.play();
  state.play.catch(() => {});
  // Capture at the start: Firefox 157 captures silence when mozCaptureStream() is called after a loop restarts.
  if (key === "capture" && (el.captureStream || el.mozCaptureStream)) {
    try { state.stream = captureOf(el); } catch (e) { state.captureErr = e; }
  }
  card.primed = card.primed || {};
  card.primed[key] = state;
}

function analyse(ctx, node) {
  const an = ctx.createAnalyser(); an.fftSize = 2048;
  const mute = ctx.createGain(); mute.gain.value = 0;
  node.connect(an); an.connect(mute); mute.connect(ctx.destination);
  return an;
}

async function sampleTone(an, ctx) {
  const buf = new Float32Array(an.fftSize);
  let best = { rms: 0, peak: 0, hz: 0 };
  for (let i = 0; i < 8; i++) {
    await sleep(80);
    an.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0, cross = 0;
    for (let k = 0; k < buf.length; k++) {
      sum += buf[k] * buf[k]; peak = Math.max(peak, Math.abs(buf[k]));
      if (k && buf[k - 1] < 0 && buf[k] >= 0) cross++;
    }
    const rms = Math.sqrt(sum / buf.length);
    if (rms > best.rms || !i) best = { rms, peak, hz: cross / (buf.length / ctx.sampleRate) };
  }
  return best;
}

function judgeTone(t, el) {
  const played = el.currentTime > 0.1;
  const line = `peak=${t.peak.toFixed(4)} rms=${t.rms.toFixed(4)} pitch≈${Math.round(t.hz)} Hz, currentTime=${el.currentTime.toFixed(2)} s`;
  if (t.peak > 0.01) return { status: "read", html: `Got audio samples: ${line}.${Math.abs(t.hz - TONE_HZ) < 40 ? " This is the known 440 Hz tone." : ""}` };
  if (!played) return { status: "noplay", html: `The element did not play, so the zeros prove nothing. ${line}.` };
  return { status: "zero", html: `The element played, but every sample is 0: ${line}.\nThis counts as blocked only if the same-origin control gives the tone.` };
}

async function runPrimed(card, key, connect) {
  const st = card.primed && card.primed[key];
  if (!st) return { status: "error", html: "Not primed. Use a Run button." };
  card.primed[key] = null;
  const { el, ctx } = st;
  try {
    if (!ctx) return { status: "na", html: "This browser has no Web Audio." };
    if (st.err) return { status: st.err.name === "SecurityError" ? "blocked" : "error", html: `Throws ${esc(errText(st.err))}` };
    const loaded = await whenLoaded(el);
    if (!loaded.ok) return { status: loaded.status, html: esc(loaded.why) };
    try { await timeout(st.play, 4000, "play()"); }
    catch (e) { return { status: "noplay", html: `play() failed: ${esc(errText(e))}. The browser needs a click to start audio.` }; }
    if (ctx.state !== "running") { try { await timeout(ctx.resume(), 2000, "AudioContext.resume()"); } catch {} }
    if (ctx.state !== "running") return { status: "noplay", html: `The AudioContext is "${ctx.state}", so the zeros prove nothing.` };
    return await connect(st);
  } catch (e) {
    return { status: e && e.name === "SecurityError" ? "blocked" : "error", html: esc(errText(e)) };
  } finally {
    el.pause(); el.remove();
  }
}

const AUDIO_WEBAUDIO = { key: "webaudio", name: "Read samples with Web Audio", code: "ctx.createMediaElementSource(audio) → AnalyserNode",
  prime: (card) => primeAudio(card, "webaudio", "element"),
  run: needsMedia((card) => runPrimed(card, "webaudio", async (st) => {
    const an = analyse(st.ctx, st.node);
    const t = await sampleTone(an, st.ctx);
    st.node.disconnect();
    return judgeTone(t, st.el);
  })) };

const AUDIO_CAPTURE = { key: "capture", name: "Capture the audio as a stream", code: `${CAPTURE_CODE} → Web Audio`,
  prime: (card) => primeAudio(card, "capture", "none"),
  run: needsMedia(async (card) => {
    const el = card.primed && card.primed.capture && card.primed.capture.el;
    if (el && !el.captureStream && !el.mozCaptureStream) {
      card.primed.capture.el.remove(); card.primed.capture = null;
      return { status: "na", html: "This browser has no captureStream on media elements." };
    }
    return runPrimed(card, "capture", async (st) => {
      if (st.captureErr) return { status: st.captureErr.name === "SecurityError" ? "blocked" : "error", html: `Throws ${esc(errText(st.captureErr))}` };
      const stream = st.stream;
      try {
        if (!stream.getAudioTracks().length) await sleep(300);
        if (!stream.getAudioTracks().length) return { status: "blocked", html: "The stream has no audio track." };
        let src;
        try { src = st.ctx.createMediaStreamSource(stream); }
        catch (e) { return { status: e.name === "SecurityError" ? "blocked" : "error", html: `createMediaStreamSource: ${esc(errText(e))}` }; }
        const t = await sampleTone(analyse(st.ctx, src), st.ctx);
        src.disconnect();
        return judgeTone(t, st.el);
      } finally { stream.getTracks().forEach((t) => t.stop()); }
    });
  }) };

function mediaRows(c) {
  return c.mode === "video"
    ? [MEDIA_VISIBLE, ...MEDIA_NET, VIDEO_PIXELS, VIDEO_EXPORT, VIDEO_WEBCODECS, VIDEO_CAPTURE]
    : [MEDIA_VISIBLE, ...MEDIA_NET, AUDIO_WEBAUDIO, AUDIO_CAPTURE];
}

// Rows where a missing API ("na") or silent output ("zero") is also a valid result.
// "zero" passes only when the paired control gives real content (see controlCheck in app.js).
const MEDIA_ALT = { webcodecs: ["na"], capture: ["na", "zero"], webaudio: ["zero"] };

function mediaCards(HOST, ID) {
  const card = (kind, tag, title, base, extra, note) => ({
    id: `${kind}-${extra.suffix}`, mode: kind, kind: extra.kindClass, tag, title, sources: mediaSources(base, kind),
    knows: `${base}/${kind === "video" ? "clip.mp4, clip.webm" : "tone.wav"}`, note, ...extra.props,
  });
  const out = [];
  for (const kind of ["video", "audio"]) {
    const what = kind === "video" ? "video (red and blue halves)" : "audio (a 440 Hz tone)";
    out.push(
      card(kind, `${kind === "video" ? "Video" : "Audio"} test`, `${kind === "video" ? "Video" : "Audio"} from the host`, `${HOST}/img/${ID}`,
        { suffix: "host", kindClass: "test", props: { expect: "blocked", alt: MEDIA_ALT, control: `${kind}-same` } },
        `<${kind} src="host URL">: synthetic ${what}. The host sends no CORS header.`),
      card(kind, "Control", `Same ${kind}, this page's origin`, `/same/${ID}`,
        { suffix: "same", kindClass: "ctl", props: { expect: "read", alt: { webcodecs: ["na"], capture: ["na"] } } },
        `This page's own server sends the same ${kind}. The page must be able to read it.`),
      card(kind, "Control", `${kind === "video" ? "Video" : "Audio"} from the host, CORS allowed`, `${HOST}/cors/${ID}`,
        { suffix: "cors", kindClass: "ctl", props: { crossOrigin: "anonymous", expect: "read", expectOverride: { nocors: "blocked" }, alt: { webcodecs: ["na"], capture: ["na"] } } },
        `The host sends Access-Control-Allow-Origin: *. The element uses crossOrigin="anonymous". A no-cors fetch always stays opaque.`),
    );
  }
  return out;
}
