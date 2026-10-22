// The media files, bundled as binary data (see "rules" in wrangler.jsonc).
// Made by scripts/make-media.mjs. Only c_7hq2m9 has media. Every other alias gets the
// placeholder, which has the same size and duration.
import webm from "./media/c_7hq2m9.webm";
import mp4 from "./media/c_7hq2m9.mp4";
import wav from "./media/c_7hq2m9.wav";
import unknownWebm from "./media/unknown.webm";
import unknownMp4 from "./media/unknown.mp4";
import unknownWav from "./media/unknown.wav";

const FILES = {
  "clip.webm": { type: "video/webm", known: webm, unknown: unknownWebm },
  "clip.mp4": { type: "video/mp4", known: mp4, unknown: unknownMp4 },
  "tone.wav": { type: "audio/wav", known: wav, unknown: unknownWav },
};

export const MEDIA_FILES = Object.keys(FILES);

export function mediaFile(alias, file) {
  const f = FILES[file];
  if (!f) return null;
  return { type: f.type, bytes: alias === "c_7hq2m9" ? f.known : f.unknown };
}
