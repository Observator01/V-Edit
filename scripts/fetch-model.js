/* Downloads the Silero VAD ONNX model into vendor/ (runs on npm install). */
const fs = require("fs");
const path = require("path");
const https = require("https");

const URL = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
const OUT = path.join(__dirname, "..", "vendor", "silero_vad.onnx");

function get(url, dest, redirects) {
  if (redirects > 5) return console.error("too many redirects");
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
      return get(res.headers.location, dest, (redirects || 0) + 1);
    if (res.statusCode !== 200) return console.error("model download failed:", res.statusCode);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const f = fs.createWriteStream(dest);
    res.pipe(f);
    f.on("finish", () => f.close(() => console.log("silero_vad.onnx ->", dest)));
  }).on("error", (e) => console.error("model download error:", e.message));
}

if (fs.existsSync(OUT) && fs.statSync(OUT).size > 500000) {
  console.log("silero_vad.onnx already present");
} else {
  get(URL, OUT, 0);
}
