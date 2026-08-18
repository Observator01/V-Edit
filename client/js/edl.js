/*
 * V-Edit — pure EDL helpers (concat-axis map, records, word remap).
 * Build NEVER subtracts VAD gaps; callers pass Claude keep ranges only.
 */
var VEEdl = (function () {
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

  function recordsFromKept(clips, kept) {
    var records = [];
    (kept || []).forEach(function (k) {
      mapToSource(clips, k.start, k.end).forEach(function (r) {
        if (!r.media) return;
        records.push(String(r.media).replace(/\\/g, "/") + ";"
          + r.srcIn.toFixed(3) + ";" + r.srcOut.toFixed(3));
      });
    });
    return records;
  }

  function remapWords(words, kept) {
    var ks = kept || [];
    var prefix = [0];
    for (var i = 0; i < ks.length; i++) prefix.push(prefix[i] + (ks[i].end - ks[i].start));
    return (words || []).filter(function (w) { return (w.type || "word") === "word"; })
      .map(function (w) {
        var mid = (w.start + w.end) / 2;
        for (var j = 0; j < ks.length; j++) {
          if (mid >= ks[j].start && mid <= ks[j].end) {
            var shift = prefix[j] - ks[j].start;
            return { text: w.text, start: w.start + shift, end: w.end + shift, type: w.type || "word" };
          }
        }
        return null;
      }).filter(Boolean);
  }

  var api = { mapToSource: mapToSource, recordsFromKept: recordsFromKept, remapWords: remapWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
