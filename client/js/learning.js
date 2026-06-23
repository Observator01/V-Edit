/*
 * V-Edit — Learning analyzer (client). Reads the user's FINISHED active sequence
 * (via host ve_analyzeFinishedSeq) and distills a style profile that seeds the
 * take-select prompt + suggests defaults. Everything stays local (~/.v-edit/).
 *
 * "Learn from mistakes" loop is scaffolded here: take-select persists its auto-EDL
 * to last-edl.json; a future diff of that vs the user's corrected final feeds back.
 */
var VELearning = (function () {
  var cs = new CSInterface();
  var fs = require("fs");
  var path = require("path");
  var os = require("os");

  function evalHost(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }
  function profilePath() { return path.join(os.homedir(), ".v-edit", "style-profile.json"); }

  function median(xs) {
    if (!xs.length) return 0;
    var a = xs.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // parse ve_analyzeFinishedSeq() output -> structured
  function parse(out) {
    var lines = out.split("\n");
    var head = lines[0].split("|");
    var seq = { name: head[0], fps: parseFloat(head[1]), dur: parseFloat(head[2]), v1n: parseInt(head[3], 10) };
    var v1 = [], vt = [];
    for (var i = 1; i < lines.length; i++) {
      var p = lines[i].split(";");
      if (p[0] === "V1" && p.length >= 7) {
        v1.push({ idx: +p[1], tl_s: +p[2], tl_e: +p[3], src_i: +p[4], src_o: +p[5], media: p[6] });
      } else if (p[0] === "VT" && p.length >= 4) {
        vt.push({ track: +p[1], n: +p[2], cov: +p[3] });
      }
    }
    return { seq: seq, v1: v1, vt: vt };
  }

  // distill a style profile from the parsed finished sequence
  function profileFrom(a) {
    var segDurs = a.v1.map(function (c) { return c.src_o - c.src_i; });
    // pauses the editor CUT = gap between consecutive kept source ranges on the same media
    var pauses = [];
    for (var i = 1; i < a.v1.length; i++) {
      var prev = a.v1[i - 1], cur = a.v1[i];
      if (prev.media && cur.media === prev.media) {
        var gap = cur.src_i - prev.src_o;
        if (gap > 0.01) pauses.push(gap);
      }
    }
    // caption track ≈ dense AND short-clipped (one cue per phrase), not long b-roll inserts.
    // Prefer the densest among short-clip (<5s avg) upper tracks; fall back to densest overall.
    a.vt.forEach(function (t) { t._avg = t.n ? t.cov / t.n : 0; });
    var shortTracks = a.vt.filter(function (t) { return t._avg > 0 && t._avg < 5; });
    var pool = shortTracks.length ? shortTracks : a.vt;
    var caption = null, brollCov = 0;
    pool.forEach(function (t) {
      if (!caption || t.n > caption.n) caption = t;
    });
    a.vt.forEach(function (t) {
      if (caption && t.track === caption.track) return;
      brollCov += t.cov;   // every other upper track counts as b-roll/graphics coverage
    });

    return {
      source: a.seq.name,
      targetSecs: a.seq.dur,
      segCount: a.v1.length,
      segMedianDur: median(segDurs),
      pauseMedian: median(pauses),
      pauseSamples: pauses.length,
      caption: caption ? { track: caption.track, count: caption.n, avgDur: caption.n ? caption.cov / caption.n : 0 } : null,
      brollCoveragePct: a.seq.dur ? Math.round((brollCov / a.seq.dur) * 100) : 0
    };
  }

  function loadProfile() {
    try { return JSON.parse(fs.readFileSync(profilePath(), "utf8")); } catch (e) { return null; }
  }

  // tolerant of profiles loaded from disk that predate current fields (schema drift)
  function summarize(p) {
    if (!p) return "—";
    var s = "target≈" + Math.round(p.targetSecs || 0) + "s · " + (p.segCount || 0) + " segs (median "
      + Number(p.segMedianDur || 0).toFixed(1) + "s) · cuts pauses≈" + Number(p.pauseMedian || 0).toFixed(2)
      + "s (" + (p.pauseSamples || 0) + ")";
    if (p.caption) s += " · captions V" + ((p.caption.track || 0) + 1) + " ×" + (p.caption.count || 0)
      + " (avg " + Number(p.caption.avgDur || 0).toFixed(1) + "s)";
    s += " · b-roll " + (p.brollCoveragePct || 0) + "%";
    return s;
  }

  async function analyze(cfg, log) {
    var out = await evalHost("ve_analyzeFinishedSeq()");
    if (!out || out.indexOf("ERR:") === 0) throw new Error(out || "no host response");
    var parsed = parse(out);
    if (!parsed.v1.length) throw new Error("active sequence has no V1 clips");
    var prof = profileFrom(parsed);
    log("analyzed '" + parsed.seq.name + "' (V1=" + parsed.v1.length + ", " + parsed.vt.length + " upper tracks)");
    try {
      fs.writeFileSync(profilePath(), JSON.stringify(prof, null, 2), "utf8");
      log("style profile → ~/.v-edit/style-profile.json");
    } catch (e) { log("WARN: could not write profile: " + e.message); }
    log("profile: " + summarize(prof));
    log("Take-Select will now use this profile to match your style.");
    return prof;
  }

  return { analyze: analyze, loadProfile: loadProfile, summarize: summarize };
})();
