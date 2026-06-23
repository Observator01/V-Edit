/*
 * V-Edit panel — UI orchestration + Auto-Cut Silence flow.
 *
 * Flow: probe active sequence (re-probe before mutating!) -> extract V1 timeline
 * audio (ffmpeg per clip, concat) -> Silero VAD -> silence gaps (timeline time)
 * -> ExtendScript ripple-cut (frame-snapped, V1+A1 only).
 *
 * Assumes contiguous V1 (a tight talking-head cut) + system ffmpeg on PATH.
 */
(function () {
  var cs = new CSInterface();
  var cp = require("child_process");
  var fs = require("fs");
  var os = require("os");
  var path = require("path");

  var statusEl = document.getElementById("status");
  var logEl = document.getElementById("log");
  function log(s) { logEl.textContent += s + "\n"; logEl.scrollTop = logEl.scrollHeight; }

  // ---- host bridge ----
  function evalHost(code) {
    return new Promise(function (resolve) { cs.evalScript(code, resolve); });
  }

  // ---- tabs ----
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      if (t.disabled) return;
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    });
  });

  // ---- settings ----
  var cfg = VEConfig.load();
  function fillSettings() {
    document.getElementById("cfg-threshold").value = cfg.threshold;
    document.getElementById("cfg-minsil").value = cfg.minSilence;
    document.getElementById("cfg-tailpad").value = cfg.tailPad;
    document.getElementById("cfg-eleven").value = cfg.elevenKey;
    document.getElementById("cfg-anthropic").value = cfg.anthropicKey;
  }
  fillSettings();
  document.getElementById("btn-save").addEventListener("click", function () {
    cfg.threshold = parseFloat(document.getElementById("cfg-threshold").value);
    cfg.minSilence = parseFloat(document.getElementById("cfg-minsil").value);
    cfg.tailPad = parseFloat(document.getElementById("cfg-tailpad").value);
    cfg.elevenKey = document.getElementById("cfg-eleven").value.trim();
    cfg.anthropicKey = document.getElementById("cfg-anthropic").value.trim();
    statusEl.textContent = VEConfig.save(cfg) ? "saved" : "save failed";
  });

  // ---- host status ----
  evalHost("ve_ping()").then(function (r) {
    if (r && r.indexOf("ok|") === 0) {
      statusEl.textContent = r.split("|")[3] || "ready";
      statusEl.className = "status ok";
    } else { statusEl.textContent = r || "no host"; statusEl.className = "status err"; }
  });

  // ---- Auto-Cut Silence ----
  function parseProbe(out) {
    var lines = out.split("\n");
    var head = lines[0].split("|");           // name|fps|v1=N|a1=M
    var fps = parseFloat(head[1]);
    var clips = [];
    for (var i = 1; i < lines.length; i++) {
      var p = lines[i].split(";");             // idx;tl_s;tl_e;src_i;src_o;media
      if (p.length < 6) continue;
      clips.push({ tl_s: +p[1], tl_e: +p[2], src_i: +p[3], src_o: +p[4], media: p[5] });
    }
    return { name: head[0], fps: fps, clips: clips };
  }

  function ffmpeg(args) {
    var r = cp.spawnSync("ffmpeg", args, { encoding: "buffer" });
    if (r.status !== 0) throw new Error("ffmpeg failed: " + (r.stderr ? r.stderr.toString().slice(-300) : r.status));
  }

  async function autoCut() {
    var btn = document.getElementById("btn-cut");
    btn.disabled = true; logEl.textContent = "";
    try {
      var probe = parseProbe(await evalHost("ve_probeSequence()"));
      if (!probe.clips.length) throw new Error("active sequence has no V1 clips");
      log("sequence: " + probe.name + "  fps=" + probe.fps + "  V1=" + probe.clips.length);

      // snapshot the locked-cut audio is what we VAD; but here we tighten the cut
      // itself, so we build the timeline WAV from V1 clip source ranges (contiguous).
      var tmp = path.join(os.tmpdir(), "vedit_" + Date.now());
      fs.mkdirSync(tmp, { recursive: true });
      var listFile = path.join(tmp, "list.txt"), parts = [];
      probe.clips.forEach(function (c, i) {
        var seg = path.join(tmp, "a" + i + ".wav");
        ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-ss", c.src_i.toFixed(3),
          "-to", c.src_o.toFixed(3), "-i", c.media, "-vn", "-ac", "1", "-ar", "16000", seg]);
        parts.push("file '" + seg.replace(/\\/g, "/") + "'");
      });
      fs.writeFileSync(listFile, parts.join("\n"));
      var tlWav = path.join(tmp, "timeline.wav");
      ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
        "-i", listFile, "-ac", "1", "-ar", "16000", tlWav]);
      log("extracted timeline audio, running VAD…");

      var buf = fs.readFileSync(tlWav);
      var res = await VEVad.silenceGaps(buf, {
        threshold: cfg.threshold, minSilence: cfg.minSilence, tailPad: cfg.tailPad
      });
      var gaps = res.gaps.filter(function (g) { return g[1] - g[0] >= cfg.minSilence; });
      log("silence gaps: " + gaps.length + "  (" +
        gaps.reduce(function (a, g) { return a + (g[1] - g[0]); }, 0).toFixed(1) + "s)");
      if (!gaps.length) { log("nothing to cut."); btn.disabled = false; return; }

      var rangesStr = gaps.map(function (g) { return g[0].toFixed(3) + ":" + g[1].toFixed(3); }).join(",");
      var before = await evalHost("ve_snapshotLockedCut()");
      var r = await evalHost('ve_autoCutSilence("' + rangesStr + '")');
      log("result: " + r);
      log("locked-cut before/after: " + before + "  ->  " + (await evalHost("ve_snapshotLockedCut()")));
      log("done. scrub to verify (no slivers, Thai endings intact).");
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    } catch (e) {
      log("ERROR: " + e.message);
    }
    btn.disabled = false;
  }
  document.getElementById("btn-cut").addEventListener("click", autoCut);
})();
