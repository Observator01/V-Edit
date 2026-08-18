var test = require("node:test");
var assert = require("node:assert/strict");
var VEEdl = require("../client/js/edl.js");

var clips = [
  { media: "E:\\a.mp4", src_i: 10, src_o: 20 },
  { media: "E:\\b.mp4", src_i: 0, src_o: 10 }
];

test("mapToSource walks concat source duration not timeline gaps", function () {
  var r = VEEdl.mapToSource(clips, 8, 14);
  assert.equal(r.length, 2);
  assert.equal(r[0].media, "E:\\a.mp4");
  assert.ok(Math.abs(r[0].srcIn - 18) < 1e-9);
  assert.ok(Math.abs(r[0].srcOut - 20) < 1e-9);
  assert.equal(r[1].media, "E:\\b.mp4");
  assert.ok(Math.abs(r[1].srcIn - 0) < 1e-9);
  assert.ok(Math.abs(r[1].srcOut - 4) < 1e-9);
});

test("recordsFromKept does not subtract a VAD gap inside a keep", function () {
  var kept = [{ start: 0, end: 20, reason: "all" }];
  var rec = VEEdl.recordsFromKept(clips, kept);
  assert.equal(rec.length, 2);
  assert.equal(rec[0], "E:/a.mp4;10.000;20.000");
  assert.equal(rec[1], "E:/b.mp4;0.000;10.000");
});

test("remapWords: keep [0,20] word at 13 -> CLEAN 13; DROP omitted", function () {
  var words = [
    { text: "ก", start: 13, end: 13.2, type: "word" },
    { text: "ข", start: 21, end: 21.2, type: "word" }
  ];
  var out = VEEdl.remapWords(words, [{ start: 0, end: 20 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "ก");
  assert.ok(Math.abs(out[0].start - 13) < 1e-9);
  assert.ok(Math.abs(out[0].end - 13.2) < 1e-9);
});

test("remapWords: two keeps shift the second block", function () {
  var words = [{ text: "ค", start: 15, end: 15.4, type: "word" }];
  var out = VEEdl.remapWords(words, [{ start: 0, end: 10 }, { start: 14, end: 20 }]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].start - 11) < 1e-9);
});
