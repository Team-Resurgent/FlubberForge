// Reports theme keys that the player never reads, so the panel cannot grow
// controls that do nothing.
const fs = require("fs");
const path = require("path");

const www = path.join(__dirname, "..", "www");
const themeSrc = fs.readFileSync(path.join(www, "theme.js"), "utf8");
const keys = [...themeSrc.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);

const consumers = ["render.js", "anim.js", "blob.js", "shields.js", "camera.js"];
const src = consumers.map((f) => fs.readFileSync(path.join(www, f), "utf8")).join("\n");

// Some keys are reached as theme["slashInnerStage1Gradient" + i], so collect
// the literal prefixes of any computed access and count those as reads too.
const prefixes = [...src.matchAll(/theme\["(\w+)"\s*\+/g)].map((m) => m[1]);

const unused = [];
for (const key of keys) {
  const direct = new RegExp("theme\\." + key + "\\b").test(src);
  const computed = prefixes.some((p) => key.startsWith(p));
  if (!direct && !computed) unused.push(key);
}

console.log("theme keys: " + keys.length);
if (unused.length) {
  console.log("UNUSED (" + unused.length + "):");
  for (const k of unused) console.log("  " + k);
  process.exitCode = 1;
} else {
  console.log("all keys are read by the player");
}
