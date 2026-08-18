var test = require("node:test");
var assert = require("node:assert/strict");
var VEAudio = require("../client/js/audio.js");

test("runPool rejects and stops when one worker fails", async function () {
  var started = 0;
  await assert.rejects(function () {
    return VEAudio.runPool([1, 2, 3, 4], 2, function (n) {
      started++;
      if (n === 2) return Promise.reject(new Error("clip fail"));
      return new Promise(function (res) { setTimeout(res, 20); });
    });
  }, /clip fail/);
  assert.ok(started < 4);
});
