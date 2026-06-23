/*
 * V-Edit panel — UI orchestration. Wires tabs, settings, Auto-Cut Silence,
 * and Captions (transcribe + generate). Premiere mutations go through host/.
 */
(function () {
  var cs = new CSInterface();
  var fs = require("fs");

  var statusEl = document.getElementById("status");
  function mkLog(id) {
    var el = document.getElementById(id);
    return function (s) { el.textContent += s + "\n"; el.scrollTop = el.scrollHeight; };
  }
  var log = mkLog("log");        // Auto-Cut
  var clog = mkLog("clog");      // Captions
  function evalHost(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }

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
      var audio = VEAudio.extractTimelineWav(probe.clips);
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
})();
