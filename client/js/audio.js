/*
 * V-Edit — shared audio helpers (Node, in the CEP panel).
 * Extracts the timeline audio of contiguous V1 clips to one 16 kHz mono WAV.
 * Used by Auto-Cut (main.js) and Transcribe (captions.js). Requires system ffmpeg.
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

  // clips = [{src_i, src_o, media}] (contiguous V1) -> { wav, cleanup() }
  function extractTimelineWav(clips) {
    var tmp = path.join(os.tmpdir(), "vedit_" + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    var listFile = path.join(tmp, "list.txt"), parts = [];
    clips.forEach(function (c, i) {
      var seg = path.join(tmp, "a" + i + ".wav");
      ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-ss", c.src_i.toFixed(3),
        "-to", c.src_o.toFixed(3), "-i", c.media, "-vn", "-ac", "1", "-ar", "16000", seg]);
      parts.push("file '" + seg.replace(/\\/g, "/") + "'");
    });
    fs.writeFileSync(listFile, parts.join("\n"));
    var wav = path.join(tmp, "timeline.wav");
    ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
      "-i", listFile, "-ac", "1", "-ar", "16000", wav]);
    return { wav: wav, cleanup: function () { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} } };
  }

  // parse ve_probeSequence() output -> { name, fps, clips:[{tl_s,tl_e,src_i,src_o,media}] }
  function parseProbe(out) {
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

  return { extractTimelineWav: extractTimelineWav, parseProbe: parseProbe, snap: snap };
})();
