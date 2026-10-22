// The avatar PNG files, bundled as binary data (see "rules" in wrangler.jsonc).
// Made by scripts/make-avatars.mjs.
import a1 from "./avatars/c_7hq2m9.png";
import a2 from "./avatars/c_3kd8w1.png";
import a3 from "./avatars/c_9xr4p6.png";
import a4 from "./avatars/c_5mv1z8.png";
import a5 from "./avatars/c_2bn7t3.png";
import unknown from "./avatars/unknown.png";

const AVATARS = { c_7hq2m9: a1, c_3kd8w1: a2, c_9xr4p6: a3, c_5mv1z8: a4, c_2bn7t3: a5 };

export const avatarPng = (id) => AVATARS[id] ?? unknown;
