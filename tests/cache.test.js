var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var VECache = require("../client/js/cache.js");

test("key changes when src_o or mtime changes", function () {
  var a = [{ media: "E:\\x.mp4", src_i: 0, src_o: 10, mtimeMs: 1 }];
  var b = [{ media: "E:\\x.mp4", src_i: 0, src_o: 10.001, mtimeMs: 1 }];
  var c = [{ media: "E:\\x.mp4", src_i: 0, src_o: 10, mtimeMs: 2 }];
  assert.notEqual(VECache.keyFromClips(a), VECache.keyFromClips(b));
  assert.notEqual(VECache.keyFromClips(a), VECache.keyFromClips(c));
  assert.equal(VECache.keyFromClips(a), VECache.keyFromClips([{
    media: "E:/x.mp4", src_i: 0, src_o: 10, mtimeMs: 1
  }]));
});

test("read miss returns nulls; writeMeta+json then read hits", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "vecache-"));
  var prev = VECache._root;
  VECache._root = dir;
  try {
    var key = "abc";
    var miss = VECache.read(key);
    assert.equal(miss.meta, null);
    assert.equal(miss.wavPath, null);
    assert.equal(miss.scribe, null);
    VECache.writeMeta(key, { name: "Seq" });
    VECache.writeJson(key, "scribe.json", { words: [] });
    var hit = VECache.read(key);
    assert.equal(hit.meta.name, "Seq");
    assert.deepEqual(hit.scribe.words, []);
  } finally { VECache._root = prev; }
});

test("hitKind classifies wav/scribe presence", function () {
  assert.equal(VECache.hitKind({ wavPath: null, scribe: null }), "none");
  assert.equal(VECache.hitKind({ wavPath: "/t.wav", scribe: null }), "wav");
  assert.equal(VECache.hitKind({ wavPath: null, scribe: {} }), "scribe");
  assert.equal(VECache.hitKind({ wavPath: "/t.wav", scribe: {} }), "both");
});
