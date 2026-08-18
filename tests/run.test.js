var test = require("node:test");
var assert = require("node:assert/strict");
var VERun = require("../client/js/run.js");

function fakeProbe() {
  return { name: "RAW", fps: 50, clips: [{ media: "E:/a.mp4", src_i: 0, src_o: 20, mtimeMs: 1 }] };
}

function deps(over) {
  var d = {
    probe: async function () { return fakeProbe(); },
    extract: async function () { return { wav: "/tmp/t.wav", extract_ms: 10 }; },
    vad: async function () { return { gaps: [[10, 12]], vad_ms: 5 }; },
    scribe: async function () {
      return { words: [{ text: "ก", start: 1, end: 2, type: "word" }], scribe_ms: 20 };
    },
    groupCues: function (words) { return [{ start: 0, end: 20, text: "ก" }]; },
    takeSelect: async function () { return { keep: [{ from_index: 0, to_index: 0, reason: "hook" }], dropped_count: 0 }; },
    buildClean: async function (plan) { d._plan = plan; return "ok|placed=1|failed=0|dur=20"; },
    snapshotRaw: async function () { return "1|20"; },
    setTranscript: function (w) { d._words = w; },
    placeCaptions: async function () { return { ok: 1, fail: 0 }; },
    persist: false
  };
  Object.assign(d, over || {});
  return d;
}

test("build refuses before analyze", async function () {
  VERun.reset();
  await assert.rejects(function () { return VERun.build({}, function () {}, deps()); }, /run Analyze first/);
});

test("build plan covers full keep including VAD gap 10-12", async function () {
  VERun.reset();
  var d = deps();
  await VERun.analyze({ elevenKey: "e", anthropicKey: "a" }, function () {}, d);
  await VERun.build({ mogrtPath: "C:/x.mogrt" }, function () {}, d);
  assert.equal(d._plan, "E:/a.mp4;0.000;20.000");
});

test("sequence name change refuses build", async function () {
  VERun.reset();
  var n = 0;
  var d = deps({
    probe: async function () {
      n++;
      return n === 1 ? fakeProbe() : { name: "OTHER", fps: 50, clips: fakeProbe().clips };
    }
  });
  await VERun.analyze({ elevenKey: "e", anthropicKey: "a" }, function () {}, d);
  await assert.rejects(function () { return VERun.build({}, function () {}, d); }, /sequence changed — re-Analyze/);
});

test("setTranscript receives remapped word inside keep", async function () {
  VERun.reset();
  var d = deps();
  await VERun.analyze({ elevenKey: "e", anthropicKey: "a" }, function () {}, d);
  await VERun.build({ mogrtPath: "C:/x.mogrt" }, function () {}, d);
  assert.equal(d._words[0].text, "ก");
});
