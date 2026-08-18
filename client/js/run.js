/*
 * V-Edit — one-pass Run orchestrator.
 * Analyze is read-only. Build creates a new CLEAN sequence. Never calls ve_autoCutSilence.
 * VAD is preview-only; EDL uses Claude keep ranges only.
 */
var VERun = (function () {
  var fs = require("fs");
  var path = require("path");
  var os = require("os");
  var cacheApi = (typeof VECache !== "undefined") ? VECache : require("./cache.js");
  var edlApi = (typeof VEEdl !== "undefined") ? VEEdl : require("./edl.js");

  var session = null;

  function reset() { session = null; }
  function getSession() { return session; }

  function attachMtimes(clips) {
    return (clips || []).map(function (c) {
      var o = {};
      for (var k in c) o[k] = c[k];
      if (o.mtimeMs == null) {
        try { o.mtimeMs = fs.statSync(c.media).mtimeMs; } catch (e) { o.mtimeMs = 0; }
      }
      return o;
    });
  }

  async function analyze(cfg, log, deps) {
    cfg = cfg || {};
    log = log || function () {};
    var probe = await deps.probe();
    if (probe.err) throw new Error(probe.err);
    if (!probe.clips.length) throw new Error("active sequence has no V1 clips");

    var clips = attachMtimes(probe.clips);
    probe = { name: probe.name, fps: probe.fps, clips: clips };
    var key = cacheApi.keyFromClips(clips);
    var cached = cacheApi.read(key);
    var kind = cacheApi.hitKind(cached);

    if (!cfg.anthropicKey) throw new Error("set the Anthropic API key (Settings)");
    if (!cfg.elevenKey && kind === "none")
      throw new Error("set the ElevenLabs and Anthropic API keys (Settings)");

    var timings = { extract_ms: 0, vad_ms: 0, scribe_ms: 0, claude_ms: 0 };
    var wavPath = cached.wavPath;
    var words = cached.scribe && cached.scribe.words;
    var gaps = cached.vad && cached.vad.gaps;

    if (!wavPath) {
      var extracted = await deps.extract(clips);
      timings.extract_ms = extracted.extract_ms || 0;
      wavPath = extracted.wav;
      try {
        cacheApi.writeWav(key, wavPath);
        cacheApi.writeMeta(key, { name: probe.name, fps: probe.fps });
        var again = cacheApi.read(key);
        if (again.wavPath) wavPath = again.wavPath;
      } catch (e) { log("cache write failed: " + e.message); }
    } else {
      log("cache_hit wav");
    }

    if (!words && !cfg.elevenKey)
      throw new Error("set the ElevenLabs and Anthropic API keys (Settings)");

    var jobs = [];
    if (!gaps) {
      jobs.push(deps.vad(wavPath).then(function (r) {
        timings.vad_ms = r.vad_ms || 0;
        gaps = r.gaps || [];
        try { cacheApi.writeJson(key, "vad.json", { gaps: gaps }); } catch (e) {}
      }));
    }
    if (!words) {
      jobs.push(deps.scribe(wavPath).then(function (r) {
        timings.scribe_ms = r.scribe_ms || 0;
        words = r.words || [];
        try { cacheApi.writeJson(key, "scribe.json", { words: words }); } catch (e) {}
      }));
    } else {
      log("cache_hit scribe");
    }
    await Promise.all(jobs);
    if (kind === "both") log("cache_hit");

    var segs = deps.groupCues(words || [], { maxGap: 0.6, maxChars: 80, maxDur: 12 });
    var tClaude = Date.now();
    var sel = await deps.takeSelect(segs, cfg);
    timings.claude_ms = Date.now() - tClaude;

    var kept = [];
    (sel.keep || []).forEach(function (k) {
      var a = segs[k.from_index], b = segs[k.to_index];
      if (!a || !b || b.end <= a.start) return;
      kept.push({ start: a.start, end: b.end, reason: k.reason || "" });
    });
    if (!kept.length) throw new Error("Claude kept no segments — check the transcript");

    var records = edlApi.recordsFromKept(clips, kept);
    if (deps.persist !== false) {
      try {
        var dir = path.join(os.homedir(), ".v-edit");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "last-edl.json"),
          JSON.stringify({ source: probe.name, kept: kept, records: records }, null, 2), "utf8");
      } catch (e) {}
    }

    log("extract_ms=" + timings.extract_ms + " vad_ms=" + timings.vad_ms
      + " scribe_ms=" + timings.scribe_ms + " claude_ms=" + timings.claude_ms);

    var dropped = [];
    (segs || []).forEach(function (s) {
      var inKeep = kept.some(function (k) { return s.start >= k.start - 1e-6 && s.end <= k.end + 1e-6; });
      if (!inKeep) dropped.push({ start: s.start, end: s.end, text: s.text || "" });
    });

    session = {
      key: key, name: probe.name, probe: probe, kept: kept, dropped: dropped,
      vad: gaps || [], words: words || [], timings: timings
    };
    return session;
  }

  async function build(cfg, log, deps) {
    cfg = cfg || {};
    log = log || function () {};
    if (!session || !session.kept || !session.kept.length) throw new Error("run Analyze first");

    var probe = await deps.probe();
    if (probe.err) throw new Error(probe.err);
    var liveKey = cacheApi.keyFromClips(attachMtimes(probe.clips));
    if (probe.name !== session.name || liveKey !== session.key)
      throw new Error("sequence changed — re-Analyze");

    var records = edlApi.recordsFromKept(session.probe.clips, session.kept);
    if (!records.length) throw new Error("no placeable source ranges");

    if (deps.snapshotRaw) {
      try { session.rawSnapshot = await deps.snapshotRaw(); } catch (e) {}
    }

    var t0 = Date.now();
    var r = await deps.buildClean(records.join("\n"));
    log("result: " + r);
    log("build_ms=" + (Date.now() - t0));

    var remapped = edlApi.remapWords(session.words, session.kept);
    if (deps.setTranscript) deps.setTranscript(remapped, session.probe.fps);

    if (!cfg.mogrtPath) {
      log("skip captions: no .mogrt");
    } else if (deps.placeCaptions) {
      var t1 = Date.now();
      try {
        var cap = await deps.placeCaptions();
        log("captions_ms=" + (Date.now() - t1));
        if (cap && cap.fail) log("caption fails=" + cap.fail + " (CLEAN kept)");
      } catch (e) {
        log("captions failed (CLEAN kept): " + e.message);
      }
    }
    return { result: r, records: records };
  }

  var api = { analyze: analyze, build: build, getSession: getSession, reset: reset };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
