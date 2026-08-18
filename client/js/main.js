/*
 * V-Edit panel — UI orchestration. Wires tabs, settings, Auto-Cut Silence,
 * and Captions (transcribe + generate). Premiere mutations go through host/.
 */
(function () {
  var cs = new CSInterface();
  var fs = require("fs");

  var statusEl = document.getElementById("status");

  // Show the loaded extension version in the header — confirms which host code is active
  // after a `git pull` (the .jsx only reloads on a full Premiere restart, not a panel reopen).
  try {
    var extRoot = cs.getSystemPath(SystemPath.EXTENSION);
    var pkg = JSON.parse(fs.readFileSync(extRoot + "/package.json", "utf8"));
    var logoEl = document.querySelector(".logo");
    if (logoEl) logoEl.textContent = "V-Edit v" + pkg.version;
  } catch (e) {}

  function mkLog(id) {
    var el = document.getElementById(id);
    return function (s) { el.textContent += s + "\n"; el.scrollTop = el.scrollHeight; };
  }
  var log = mkLog("log");        // Auto-Cut
  var clog = mkLog("clog");      // Captions
  var tslog = mkLog("tslog");    // Take-Select
  var rlog = mkLog("runlog");    // Run
  function evalHost(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }

  function stampMtimes(clips) {
    (clips || []).forEach(function (c) {
      if (c.mtimeMs == null) {
        try { c.mtimeMs = fs.statSync(c.media).mtimeMs; } catch (e) { c.mtimeMs = 0; }
      }
    });
    return clips;
  }

  function runDeps() {
    return {
      probe: async function () { return VEAudio.parseProbe(await evalHost("ve_probeSequence()")); },
      extract: async function (clips) { return VEAudio.extractTimelineWav(clips); },
      vad: async function (wavPath) {
        var t0 = Date.now();
        var res = await VEVad.silenceGaps(fs.readFileSync(wavPath), {
          threshold: cfg.threshold, minSilence: cfg.minSilence, tailPad: cfg.tailPad
        });
        return { gaps: res.gaps || [], vad_ms: Date.now() - t0 };
      },
      scribe: async function (wavPath) {
        var t0 = Date.now();
        var data = await VEProviders.scribe(fs.readFileSync(wavPath), cfg.elevenKey, "tha");
        return { words: data.words || [], scribe_ms: Date.now() - t0 };
      },
      groupCues: function (words, opts) { return VECaptions.groupCues(words, opts); },
      takeSelect: async function (segs, c) {
        var profile = VELearning.loadProfile();
        return VEProviders.takeSelect(segs, c.anthropicKey, {
          model: c.takeModel, targetSecs: c.targetSecs || 90, profile: profile
        });
      },
      buildClean: async function (plan) {
        return evalHost("ve_buildCleanSeq(" + JSON.stringify(plan) + ")");
      },
      snapshotRaw: async function () { return evalHost("ve_snapshotLockedCut()"); },
      setTranscript: function (words, fps) { VECaptions.setTranscript(words, fps); },
      placeCaptions: async function () { return VECaptions.doGenerate(cfg, rlog); }
    };
  }

  function renderPreview(sess) {
    var el = document.getElementById("run-preview");
    if (!sess) { el.hidden = true; el.innerHTML = ""; return; }
    var lines = [];
    (sess.kept || []).forEach(function (k, i) {
      lines.push('<div class="layer-keep">KEEP [' + i + '] ' + k.start.toFixed(1) + "–" + k.end.toFixed(1)
        + "s" + (k.reason ? "  · " + k.reason : "") + "</div>");
    });
    (sess.dropped || []).forEach(function (d) {
      lines.push('<div class="layer-drop">DROP ' + d.start.toFixed(1) + "–" + d.end.toFixed(1)
        + "s" + (d.text ? "  · " + d.text : "") + "</div>");
    });
    (sess.vad || []).forEach(function (g) {
      var a = g[0], b = g[1];
      if (b - a < (cfg.minSilence || 0.4)) return;
      lines.push('<div class="layer-vad">VAD  ' + Number(a).toFixed(1) + "–" + Number(b).toFixed(1)
        + "s  (preview only — not cut)</div>");
    });
    el.innerHTML = lines.join("") || "<div>no preview</div>";
    el.hidden = false;
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
    document.getElementById("cfg-mogrt").value = cfg.mogrtPath;
    document.getElementById("cfg-track").value = (cfg.captionTrack || 1) + 1; // show 1-based
    document.getElementById("cfg-captiontext").value = cfg.captionTextLayer || "";
    document.getElementById("cfg-takemodel").value = cfg.takeModel || "claude-sonnet-4-6";
    document.getElementById("cfg-target").value = cfg.targetSecs || 90;
  }
  fillSettings();
  document.getElementById("btn-save").addEventListener("click", function () {
    cfg.threshold = parseFloat(document.getElementById("cfg-threshold").value);
    cfg.minSilence = parseFloat(document.getElementById("cfg-minsil").value);
    cfg.tailPad = parseFloat(document.getElementById("cfg-tailpad").value);
    cfg.elevenKey = document.getElementById("cfg-eleven").value.trim();
    cfg.anthropicKey = document.getElementById("cfg-anthropic").value.trim();
    cfg.mogrtPath = document.getElementById("cfg-mogrt").value.trim();
    cfg.captionTrack = Math.max(1, (parseInt(document.getElementById("cfg-track").value, 10) || 2) - 1);
    cfg.captionTextLayer = document.getElementById("cfg-captiontext").value.trim();
    cfg.takeModel = document.getElementById("cfg-takemodel").value.trim() || "claude-sonnet-4-6";
    cfg.targetSecs = parseInt(document.getElementById("cfg-target").value, 10) || 90;
    statusEl.textContent = VEConfig.save(cfg) ? "saved" : "save failed";
  });
  document.getElementById("btn-browse").addEventListener("click", function () {
    try {
      var r = window.cep.fs.showOpenDialog(false, false, "Pick a .mogrt template", "", ["mogrt"]);
      if (r && r.data && r.data.length) {
        document.getElementById("cfg-mogrt").value = r.data[0];
      }
    } catch (e) { statusEl.textContent = "browse n/a — paste path"; }
  });

  // ---- host status ----
  evalHost("ve_ping()").then(function (r) {
    if (r && r.indexOf("ok|") === 0) {
      statusEl.textContent = r.split("|")[3] || "ready"; statusEl.className = "status ok";
    } else { statusEl.textContent = r || "no host"; statusEl.className = "status err"; }
  });

  // ---- Auto-Cut Silence ----
  async function autoCut() {
    var btn = document.getElementById("btn-cut");
    btn.disabled = true; document.getElementById("log").textContent = "";
    try {
      var probe = VEAudio.parseProbe(await evalHost("ve_probeSequence()"));
      if (!probe.clips.length) throw new Error("active sequence has no V1 clips");
      log("sequence: " + probe.name + "  fps=" + probe.fps + "  V1=" + probe.clips.length);
      stampMtimes(probe.clips);
      var chit = VECache.read(VECache.keyFromClips(probe.clips));
      var audio;
      if (chit.wavPath) {
        log("cache_hit wav");
        audio = { wav: chit.wavPath, cleanup: function () {} };
      } else {
        audio = await VEAudio.extractTimelineWav(probe.clips);
      }
      try {
        log("extracted timeline audio, running VAD…");
        var res = await VEVad.silenceGaps(fs.readFileSync(audio.wav),
          { threshold: cfg.threshold, minSilence: cfg.minSilence, tailPad: cfg.tailPad });
        var gaps = res.gaps.filter(function (g) { return g[1] - g[0] >= cfg.minSilence; });
        log("silence gaps: " + gaps.length + " (" +
          gaps.reduce(function (a, g) { return a + (g[1] - g[0]); }, 0).toFixed(1) + "s)");
        if (!gaps.length) { log("nothing to cut."); return; }
        var rangesStr = gaps.map(function (g) { return g[0].toFixed(3) + ":" + g[1].toFixed(3); }).join(",");
        log("result: " + await evalHost('ve_autoCutSilence("' + rangesStr + '")'));
        log("done. scrub to verify (no slivers, Thai endings intact).");
      } finally { audio.cleanup(); }
    } catch (e) { log("ERROR: " + e.message); }
    btn.disabled = false;
  }
  document.getElementById("btn-cut").addEventListener("click", autoCut);

  // ---- Captions ----
  document.getElementById("btn-transcribe").addEventListener("click", async function () {
    var btn = this; btn.disabled = true; document.getElementById("clog").textContent = "";
    try { await VECaptions.doTranscribe(cfg, clog); } catch (e) { clog("ERROR: " + e.message); }
    btn.disabled = false;
  });
  document.getElementById("btn-captions").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    try { await VECaptions.doGenerate(cfg, clog); } catch (e) { clog("ERROR: " + e.message); }
    btn.disabled = false;
  });
  document.getElementById("btn-diag").addEventListener("click", async function () {
    var btn = this; btn.disabled = true; document.getElementById("clog").textContent = "";
    try { clog(await evalHost("ve_diagnoseCaption(" + (cfg.captionTrack || 1) + ")")); }
    catch (e) { clog("ERROR: " + e.message); }
    btn.disabled = false;
  });

  // ---- Take-Select + Learning ----
  function refreshProfileSummary() {
    var el = document.getElementById("profile-summary");
    try {
      var p = VELearning.loadProfile();
      el.textContent = "profile: " + (p ? VELearning.summarize(p) : "— (none yet)");
    } catch (e) { el.textContent = "profile: — (none yet)"; }
  }
  refreshProfileSummary();

  document.getElementById("btn-learn").addEventListener("click", async function () {
    var btn = this; btn.disabled = true; document.getElementById("tslog").textContent = "";
    try { await VELearning.analyze(cfg, tslog); refreshProfileSummary(); }
    catch (e) { tslog("ERROR: " + e.message); }
    btn.disabled = false;
  });

  // keep cfg.targetSecs synced with the on-tab field before selecting
  function syncTarget() {
    cfg.targetSecs = parseInt(document.getElementById("cfg-target").value, 10) || cfg.targetSecs || 90;
  }
  document.getElementById("btn-select").addEventListener("click", async function () {
    var btn = this; btn.disabled = true; document.getElementById("tslog").textContent = "";
    syncTarget();
    try { await VETakeSelect.doSelect(cfg, tslog); } catch (e) { tslog("ERROR: " + e.message); }
    btn.disabled = false;
  });
  document.getElementById("btn-build").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    try { await VETakeSelect.doBuild(cfg, tslog); } catch (e) { tslog("ERROR: " + e.message); }
    btn.disabled = false;
  });

  // ---- Run (one-pass) ----
  var btnAnalyze = document.getElementById("btn-analyze");
  var btnRunBuild = document.getElementById("btn-run-build");
  btnAnalyze.addEventListener("click", async function () {
    btnAnalyze.disabled = true; btnRunBuild.disabled = true;
    document.getElementById("runlog").textContent = "";
    renderPreview(null);
    syncTarget();
    try {
      var sess = await VERun.analyze(cfg, rlog, runDeps());
      renderPreview(sess);
      btnRunBuild.disabled = false;
    } catch (e) { rlog("ERROR: " + e.message); }
    btnAnalyze.disabled = false;
  });
  btnRunBuild.addEventListener("click", async function () {
    btnAnalyze.disabled = true; btnRunBuild.disabled = true;
    try { await VERun.build(cfg, rlog, runDeps()); }
    catch (e) { rlog("ERROR: " + e.message); }
    btnAnalyze.disabled = false;
    btnRunBuild.disabled = !VERun.getSession();
  });
})();
