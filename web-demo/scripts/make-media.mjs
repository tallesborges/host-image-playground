// Makes the synthetic media files in src/media/ with ffmpeg (needs libvpx and libx264).
// Run again after you change a signal below: `bun run media`.
//
// Known signals, so a test can tell real content from silence or black frames:
//   c_7hq2m9 video: 160 × 90, 2 s, 10 fps. Left half red (220,40,40), right half blue (40,80,220).
//   c_7hq2m9 audio: 2 s mono WAV, 16 kHz, 440 Hz sine at amplitude 0.5.
//   unknown:        the same size and duration. Gray video, silent audio.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const OUT = new URL("../src/media/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const W = 160, H = 90, SECONDS = 2, FPS = 10, RATE = 16000;
const CLIPS = [
  { id: "c_7hq2m9", left: "0xdc2828", right: "0x2850dc", audio: `aevalsrc=0.5*sin(2*PI*440*t):s=${RATE}:d=${SECONDS}` },
  { id: "unknown", left: "0x808080", right: "0x808080", audio: `anullsrc=r=${RATE}:cl=mono:d=${SECONDS}` },
];
const COMMON = ["-hide_banner", "-loglevel", "error", "-y"];
const OUTPUT = ["-map_metadata", "-1", "-fflags", "+bitexact"];

function ffmpeg(args) {
  const file = args.pop();
  const r = spawnSync("ffmpeg", [...COMMON, ...args, ...OUTPUT, file], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

for (const c of CLIPS) {
  const video = [
    "-f", "lavfi", "-i", `color=c=${c.left}:s=${W}x${H}:r=${FPS}:d=${SECONDS}`,
    "-vf", `drawbox=x=${W / 2}:y=0:w=${W / 2}:h=${H}:color=${c.right}:t=fill,format=yuv420p`, "-an",
  ];
  ffmpeg([...video, "-c:v", "libvpx", "-b:v", "200k", "-auto-alt-ref", "0", `${OUT}${c.id}.webm`]);
  ffmpeg([...video, "-c:v", "libx264", "-profile:v", "baseline", "-movflags", "+faststart", `${OUT}${c.id}.mp4`]);
  ffmpeg(["-f", "lavfi", "-i", c.audio, "-ac", "1", "-c:a", "pcm_s16le", `${OUT}${c.id}.wav`]);
}
console.log(`Wrote ${CLIPS.length * 3} files to ${OUT}`);
