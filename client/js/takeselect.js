/*
 * V-Edit — AI take-select flow (client). Two steps, mirroring Captions' caution
 * (the proven build script had a --dry mode):
 *   1 · Select  — transcribe the RAW recording + ask Claude which takes to keep (preview).
 *   2 · Build   — clone→clear→place the kept takes on a NEW "<name> - CLEAN" sequence.
 *
 * The RAW sequence is NEVER mutated (we build a separate sequence). Transcript timing =
 * timeline time (we transcribe the cut's own audio), so Claude returns timeline ranges;
 * we map each back to per-clip source in/out before placing.
 */
var VETakeSelect = (function () {
  var cs = new CSInterface();
  var fs = require("fs");
  var path = require("path");
  var os = require("os");

  var cache = null;  // { name, probe, kept:[{start,end,reason}] } from the last Select

  function evalHost(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }

  // ---- step 1: select (preview, no mutation) ----
  async function doSelect(cfg, log) {
    if (!cfg.anthropicKey) throw new Error("set the Anthropic API key (Settings)");
    var probe = VEAudio.parseProbe(await evalHost("ve_probeSequence()"));
    if (probe.err) throw new Error(probe.err);
    if (!probe.clips.length) throw new Error("active sequence has no V1 clips");
    log("raw: " + probe.name + "  fps=" + probe.fps + "  V1=" + probe.clips.length);

    var audio = VEAudio.extractTimelineWav(probe.clips);
    try {
      log("transcribing (ElevenLabs Scribe)…");
      var data = await VEProviders.scribe(fs.readFileSync(audio.wav), cfg.elevenKey, "tha");
      var words = data.words || [];
      // line-level segments (wider grouping than caption cues)
      var segs = VECaptions.groupCues(words, { maxGap: 0.6, maxChars: 80, maxDur: 12 });
      log("Scribe: " + words.length + " words → " + segs.length + " line-segments");

      var profile = VELearning.loadProfile();
      if (profile) log("style profile: " + VELearning.summarize(profile));
      else log("no style profile yet (run Analyze on a finished cut to improve selection)");

      log("asking Claude (" + (cfg.takeModel || "claude-sonnet-4-6") + ") to pick the best takes…");
      var sel = await VEProviders.takeSelect(segs, cfg.anthropicKey, {
        model: cfg.takeModel, targetSecs: cfg.targetSecs || 90, profile: profile
      });

      var kept = [];
      (sel.keep || []).forEach(function (k) {
        var a = segs[k.from_index], b = segs[k.to_index];
        if (!a || !b || b.end <= a.start) return;
        kept.push({ start: a.start, end: b.end, reason: k.reason || "" });
      });
      if (!kept.length) throw new Error("Claude kept no segments — check the transcript");

      cache = { name: probe.name, probe: probe, kept: kept };
      var total = kept.reduce(function (s, k) { return s + (k.end - k.start); }, 0);
      log("✓ selected " + kept.length + " takes ≈ " + total.toFixed(1) + "s (dropped "
        + (sel.dropped_count != null ? sel.dropped_count : "?") + ")");
      kept.slice(0, 8).forEach(function (k, i) {
        log("  [" + i + "] " + k.start.toFixed(1) + "–" + k.end.toFixed(1) + "s"
          + (k.reason ? "  · " + k.reason : ""));
      });
      if (kept.length > 8) log("  …+" + (kept.length - 8) + " more");
      log("review, then press '2 · Build CLEAN sequence'.");
    } finally { audio.cleanup(); }
  }

  // map a transcript-time range -> per-clip source ranges (split where it straddles clips).
  // Transcript time is the CONCATENATED timeline (extractTimelineWav joins each clip's
  // [src_i,src_o] back-to-back), so we walk a cumulative source-duration axis — NOT the
  // sequence tl_s/tl_e (which can have gaps). This is correct for single- and multi-clip raws.
  function mapToSource(clips, tA, tB) {
    var out = [], cum = 0;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var dur = c.src_o - c.src_i;
      var cumStart = cum, cumEnd = cum + dur;
      cum = cumEnd;
      var s = Math.max(tA, cumStart), e = Math.min(tB, cumEnd);
      if (e - s <= 0.001) continue;
      out.push({
        media: c.media,
        srcIn: c.src_i + (s - cumStart),
        srcOut: c.src_i + (e - cumStart)
      });
    }
    return out;
  }

  // ---- step 2: build the CLEAN sequence ----
  async function doBuild(cfg, log) {
    if (!cache || !cache.kept.length) throw new Error("run '1 · Select' first");
    // re-probe: confirm the same raw sequence is still active (user switches constantly)
    var probe = VEAudio.parseProbe(await evalHost("ve_probeSequence()"));
    if (probe.err) throw new Error(probe.err);
    if (probe.name !== cache.name) throw new Error("active sequence changed to '" + probe.name + "' — re-Select");

    var records = [];
    cache.kept.forEach(function (k) {
      mapToSource(cache.probe.clips, k.start, k.end).forEach(function (r) {
        if (!r.media) return;
        records.push(r.media.replace(/\\/g, "/") + ";" + r.srcIn.toFixed(3) + ";" + r.srcOut.toFixed(3));
      });
    });
    if (!records.length) throw new Error("no placeable source ranges");

    log("building '" + cache.name + " - CLEAN' from " + records.length + " segments…");
    var plan = records.join("\n");
    var r = await evalHost("ve_buildCleanSeq(" + JSON.stringify(plan) + ")");
    log("result: " + r);

    // persist the auto-EDL — seeds the future "learn from my corrections" diff
    try {
      var dir = path.join(os.homedir(), ".v-edit");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "last-edl.json"),
        JSON.stringify({ source: cache.name, kept: cache.kept, records: records }, null, 2), "utf8");
      log("saved auto-EDL → ~/.v-edit/last-edl.json");
    } catch (e) {}

    if (String(r).indexOf("ok|") === 0) {
      log("✓ NEW sequence created — your raw cut is untouched.");
      log("Now add b-roll on V2+, transitions, SFX, and captions yourself.");
    } else {
      log("!! build did not complete cleanly — check the result above.");
    }
  }

  return { doSelect: doSelect, doBuild: doBuild };
})();
