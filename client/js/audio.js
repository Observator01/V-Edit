/*
 * V-Edit — shared audio helpers (Node, in the CEP panel).
 * Extracts the timeline audio of contiguous V1 clips to one 16 kHz mono WAV.
 * Used by Auto-Cut, Transcribe, and Run. Requires system ffmpeg.
 */
var VEAudio = (function () {
  var cp = require("child_process");
  var fs = require("fs");
  var os = require("os");
  var path = require("path");

  function ffmpeg(args) {
    var r = cp.spawnSync("ffmpeg", args, { encoding: "buffer" });
    if (r.status !== 0)
      throw new Error("ffmpeg failed: " + (r.stderr ? r.stderr.toString().slice(-300) : r.status));
  }

  function ffmpegAsync(args) {
    return new Promise(function (resolve, reject) {
      var p = cp.spawn("ffmpeg", args);
      var err = [];
      if (p.stderr) p.stderr.on("data", function (d) { err.push(d); });
      p.on("error", reject);
      p.on("close", function (code) {
        if (code === 0) resolve();
        else reject(new Error("ffmpeg failed: " + Buffer.concat(err).toString().slice(-300)));
      });
    });
  }

  function runPool(items, limit, worker) {
    return new Promise(function (resolve, reject) {
      var i = 0, active = 0, done = 0, rejected = false;
      function launch() {
        if (rejected) return;
        while (active < limit && i < items.length) {
          (function (idx) {
            active++;
            Promise.resolve(worker(items[idx], idx)).then(function () {
              active--;
              done++;
              if (done === items.length) resolve();
              else launch();
            }, function (err) {
              if (rejected) return;
              rejected = true;
              reject(err);
            });
          })(i++);
        }
      }
      if (!items.length) resolve();
      else launch();
    });
  }

  // clips = [{src_i, src_o, media}] -> Promise<{ wav, cleanup(), extract_ms }>
  // opts.concurrency default 4. opts.outDir: copy timeline.wav there only after concat succeeds.
  async function extractTimelineWav(clips, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var tmp = path.join(os.tmpdir(), "vedit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tmp, { recursive: true });
    var cleanup = function () { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
    var parts = [];
    function segArgs(c, i) {
      var seg = path.join(tmp, "a" + i + ".wav");
      parts[i] = "file '" + seg.replace(/\\/g, "/") + "'";
      return ["-hide_banner", "-loglevel", "error", "-y", "-ss", c.src_i.toFixed(3),
        "-to", c.src_o.toFixed(3), "-i", c.media, "-vn", "-ac", "1", "-ar", "16000", seg];
    }
    try {
      if (typeof cp.spawn !== "function") {
        clips.forEach(function (c, i) { ffmpeg(segArgs(c, i)); });
      } else {
        await runPool(clips, opts.concurrency || 4, function (c, i) { return ffmpegAsync(segArgs(c, i)); });
      }
      var listFile = path.join(tmp, "list.txt");
      fs.writeFileSync(listFile, parts.join("\n"));
      var wav = path.join(tmp, "timeline.wav");
      ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
        "-i", listFile, "-ac", "1", "-ar", "16000", wav]);
      if (opts.outDir) {
        fs.mkdirSync(opts.outDir, { recursive: true });
        var dest = path.join(opts.outDir, "timeline.wav");
        fs.copyFileSync(wav, dest);
        wav = dest;
      }
      return { wav: wav, cleanup: cleanup, extract_ms: Date.now() - t0 };
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  function parseProbe(out) {
    if (!out || out.indexOf("ERR:") === 0)
      return { name: out || "", fps: NaN, clips: [], err: out || "no host response" };
    var lines = out.split("\n");
    var head = lines[0].split("|");
    var clips = [];
    for (var i = 1; i < lines.length; i++) {
      var p = lines[i].split(";");
      if (p.length < 6) continue;
      clips.push({ tl_s: +p[1], tl_e: +p[2], src_i: +p[3], src_o: +p[4], media: p[5] });
    }
    return { name: head[0], fps: parseFloat(head[1]), clips: clips };
  }

  function snap(sec, fps) { return fps ? Math.round(sec * fps) / fps : sec; }

  var api = {
    extractTimelineWav: extractTimelineWav,
    parseProbe: parseProbe,
    snap: snap,
    runPool: runPool
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
