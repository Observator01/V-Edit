/*
 * V-Edit — disk cache for one-pass pipeline (wav / scribe / vad / meta).
 * Keyed by clip path + src in/out + mtime. Local only (~/.v-edit/cache/).
 */
var VECache = (function () {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var crypto = require("crypto");

  var api = { _root: path.join(os.homedir(), ".v-edit", "cache") };

  function normalizePath(p) { return String(p || "").replace(/\\/g, "/"); }
  api.normalizePath = normalizePath;

  api.keyFromClips = function (clips) {
    var lines = (clips || []).map(function (c) {
      var mt = c.mtimeMs;
      if (mt == null) {
        try { mt = fs.statSync(c.media).mtimeMs; } catch (e) { mt = 0; }
      }
      return normalizePath(c.media) + "|" + Number(c.src_i).toFixed(3) + "|"
        + Number(c.src_o).toFixed(3) + "|" + mt;
    });
    return crypto.createHash("sha1").update(lines.join("\n")).digest("hex");
  };

  api.dirFor = function (key) { return path.join(api._root, key); };

  api.read = function (key) {
    var dir = api.dirFor(key);
    function json(name) {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
      catch (e) { return null; }
    }
    var wav = path.join(dir, "timeline.wav");
    return {
      meta: json("meta.json"),
      wavPath: fs.existsSync(wav) ? wav : null,
      scribe: json("scribe.json"),
      vad: json("vad.json")
    };
  };

  function ensure(key) {
    var dir = api.dirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  api.writeMeta = function (key, meta) {
    fs.writeFileSync(path.join(ensure(key), "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  };
  api.writeJson = function (key, name, obj) {
    fs.writeFileSync(path.join(ensure(key), name), JSON.stringify(obj, null, 2), "utf8");
  };
  api.writeWav = function (key, srcPath) {
    var dest = path.join(ensure(key), "timeline.wav");
    fs.copyFileSync(srcPath, dest);
    return dest;
  };
  api.sessionFallbackDir = function () {
    return path.join(os.tmpdir(), "vedit-cache-session");
  };
  api.hitKind = function (r) {
    if (!r) return "none";
    if (r.wavPath && r.scribe) return "both";
    if (r.scribe) return "scribe";
    if (r.wavPath) return "wav";
    return "none";
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
