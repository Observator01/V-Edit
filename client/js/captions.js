/*
 * V-Edit — Transcribe (ElevenLabs Scribe) + MOGRT captions (additive V2/V3).
 * Ported from video-agent captions_clean.py (cue grouping) + tank500_captions_mogrt.py.
 *
 * Transcript timing = timeline time (we transcribe the cut's own audio), so cues
 * map straight onto the timeline. Captions are placed additively on the chosen
 * caption track — V1/A1 are never touched.
 */
var VECaptions = (function () {
  var cs = new CSInterface();
  var fs = require("fs");
  var transcript = null;  // last Scribe result (cached for Generate)

  function evalHost(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }

  // group flat Scribe words into clean caption cues. Break on a real pause
  // (gap > maxGap) — never mid-word (Thai has no spaces; tokens within a phrase
  // have ~0 gap). Also cap chars/dur. words: [{text,start,end,type}].
  function groupCues(words, opts) {
    var o = Object.assign({ maxGap: 0.45, maxChars: 30, maxDur: 4.0 }, opts || {});
    var w = words.filter(function (x) { return (x.type || "word") === "word"; });
    if (!w.length) return [];
    var cues = [], cur = [w[0]];
    function flush() {
      if (!cur.length) return;
      var text = cur.map(function (x) { return x.text; }).join("").trim();
      if (text) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: text });
      cur = [];
    }
    for (var i = 1; i < w.length; i++) {
      var gap = w[i].start - w[i - 1].end;
      var curText = cur.map(function (x) { return x.text; }).join("").length;
      var curDur = cur.length ? w[i - 1].end - cur[0].start : 0;
      if (gap > o.maxGap || curText >= o.maxChars || curDur >= o.maxDur) { flush(); }
      cur.push(w[i]);
    }
    flush();
    return cues;
  }

  // run Scribe on the active sequence's timeline audio
  async function doTranscribe(cfg, log) {
    var probe = VEAudio.parseProbe(await evalHost("ve_probeSequence()"));
    if (!probe.clips.length) throw new Error("active sequence has no V1 clips");
    log("transcribing " + probe.name + " (V1=" + probe.clips.length + ")…");
    var audio = VEAudio.extractTimelineWav(probe.clips);
    try {
      var buf = fs.readFileSync(audio.wav);
      var data = await VEProviders.scribe(buf, cfg.elevenKey, "tha");
      transcript = { words: data.words || [], fps: probe.fps };
      var cues = groupCues(transcript.words);
      log("Scribe: " + transcript.words.length + " words -> " + cues.length + " cues");
      log("preview: " + cues.slice(0, 4).map(function (c) { return c.text; }).join(" / "));
      return cues;
    } finally { audio.cleanup(); }
  }

  // place MOGRT captions on the caption track from the cached transcript
  async function doGenerate(cfg, log) {
    if (!transcript) throw new Error("transcribe first");
    if (!cfg.mogrtPath || !fs.existsSync(cfg.mogrtPath)) throw new Error("set a .mogrt template (Settings)");
    var fps = transcript.fps;
    var track = cfg.captionTrack || 1;     // 0-based; 1 = V2
    var cues = groupCues(transcript.words);
    if (!cues.length) throw new Error("no cues");

    var hint = (cfg.captionTextLayer || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var before = await evalHost("ve_snapshotLockedCut()");
    log("clear V" + (track + 1) + ": " + await evalHost("ve_clearCaptionTrack(" + track + ")"));
    var ok = 0, fail = 0, notext = 0, notextSample = "";
    for (var i = 0; i < cues.length; i++) {
      var a = VEAudio.snap(cues[i].start, fps);
      var b = VEAudio.snap(cues[i].end, fps);
      var txt = cues[i].text.replace(/"/g, '\\"').replace(/\n/g, " ");
      var r = String(await evalHost('ve_placeCaption("' + cfg.mogrtPath.replace(/\\/g, "/") +
        '", ' + track + ', ' + a + ', ' + b + ', "' + txt + '", "' + hint + '")'));
      if (r.indexOf("ok|notext") === 0) { notext++; if (!notextSample) notextSample = r; }
      else if (r.indexOf("ok|") === 0) ok++;
      else { fail++; log("  cue " + i + " " + r); }
    }
    var after = await evalHost("ve_snapshotLockedCut()");
    log("placed " + (ok + notext) + " captions (" + fail + " failed) on V" + (track + 1));
    if (notext) {
      log("⚠ but could NOT set text on " + notext + " — the template's text control wasn't matched.");
      log("  " + notextSample);  // layers=Comp[prop/prop] … — the editable text control name is one of these
      log("  → copy that control name (inside the [ ]) into Settings ▸ \"Caption text layer\" and Generate again.");
    }
    log("locked-cut before/after: " + before + " -> " + after +
      (before === after ? "  (V1/A1 untouched ✓)" : "  !! CHANGED — undo !!"));
  }

  return { groupCues: groupCues, doTranscribe: doTranscribe, doGenerate: doGenerate };
})();
