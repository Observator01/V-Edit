/*
 * V-Edit — local config (API keys + thresholds). Stored as JSON in the CEP
 * extension's user-data folder. Keys never leave the machine except to the
 * provider's own API.
 */
var VEConfig = (function () {
  var fs = require("fs");
  var path = require("path");
  var os = require("os");

  function file() {
    var dir = path.join(os.homedir(), ".v-edit");
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    return path.join(dir, "config.json");
  }

  var defaults = {
    threshold: 0.5, minSilence: 0.4, tailPad: 0.25,
    elevenKey: "", anthropicKey: "",
    mogrtPath: "", captionTrack: 1   // captionTrack: 0-based video track; 1 = V2
  };

  function load() {
    try {
      var raw = fs.readFileSync(file(), "utf8");
      var obj = JSON.parse(raw);
      for (var k in defaults) if (!(k in obj)) obj[k] = defaults[k];
      return obj;
    } catch (e) { return Object.assign({}, defaults); }
  }

  function save(cfg) {
    try { fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), "utf8"); return true; }
    catch (e) { return false; }
  }

  return { load: load, save: save, defaults: defaults };
})();
