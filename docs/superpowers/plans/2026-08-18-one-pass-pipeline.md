# V-Edit One-Pass Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Run tab that Analyze-then-Build a CLEAN sequence + captions in 2 clicks, with disk cache and one extract/Scribe, without mutating the raw cut or applying VAD to the EDL.

**Architecture:** Pure Node-testable units (`VECache`, `VEEdl`) plus a `VERun` orchestrator in the CEP panel. Existing host JSX is unchanged. Old tabs stay and read the same cache. VAD runs for preview only; Build uses Claude keep ranges only.

**Tech Stack:** CEP panel (HTML/JS + Node), `ffmpeg` on PATH, `onnxruntime-node` + Silero (existing), ElevenLabs Scribe + Anthropic (existing), Node 24 native `node --test` for logic tests. No new npm deps.

**Spec (source of truth after copy):** `E:\Claude-Workspace\V-Edit\docs\superpowers\specs\2026-08-18-one-pass-pipeline-design.md`

**Repo root (implement here only):** `E:\Claude-Workspace\V-Edit`

**Not the work tree:** `%APPDATA%\Adobe\CEP\extensions\V-Edit` is the Premiere install/copy. Do not edit it. Draft spec currently lives there from brainstorming — copy it into the source repo first.

## Work location (do this before Task 1)

1. Copy spec → `E:\Claude-Workspace\V-Edit\docs\superpowers\specs\2026-08-18-one-pass-pipeline-design.md`
2. Write plan → `E:\Claude-Workspace\V-Edit\docs\superpowers\plans\2026-08-18-one-pass-pipeline.md`
3. All file creates/edits/tests/commits happen in `E:\Claude-Workspace\V-Edit`
4. After a shippable 0.3.8, sync source → CEP folder (copy or existing deploy script) so Premiere loads it. Restart Premiere / reload panel then.

## Global Constraints

- Premiere Pro 24+ CEP panel; Node enabled. Do not add host JSX APIs.
- Run NEVER calls `ve_autoCutSilence`. Raw V1/A1 must be identical before/after Run.
- Build EDL = Claude keep ranges only. Do not subtract VAD gaps.
- Cache lives in `~/.v-edit/cache/<key>/`. Never commit cache or API keys.
- Time axis = concatenation of each V1 clip `[src_i, src_o]`, not sequence `tl_s/tl_e`.
- Old tabs stay. They reuse cache on matching key; they do not disappear.
- No sidecar worker. No auto b-roll. No take-select quality rewrite. No caption styling.
- IIFE modules (existing style) plus `module.exports` so Node tests can `require` them.
- Tests that do not need Premiere run via `node --test tests/*.test.js` from the repo root.
- Copy exact error strings from this plan so later tasks and tests match.

## File map

| File | Role |
|---|---|
| `client/js/cache.js` | **Create.** `VECache` — key, dir, read/write wav/json, session fallback |
| `client/js/edl.js` | **Create.** `VEEdl` — `mapToSource`, `recordsFromKept`, `remapWords` (no VAD subtract) |
| `client/js/run.js` | **Create.** `VERun.analyze` / `VERun.build` |
| `client/js/audio.js` | Parallel `ffmpeg` (max 4), optional `outDir` so wav lands in cache |
| `client/js/captions.js` | `setTranscript`; `doTranscribe` cache hit |
| `client/js/takeselect.js` | Use `VEEdl.mapToSource`; `doSelect` cache hit |
| `client/js/vad.js` | No algorithm change; Analyze writes `vad.json` via VECache |
| `client/js/main.js` | Wire Run tab; Auto-Cut uses cached wav |
| `client/index.html` | Run tab first; Analyze / Build / layered preview / log |
| `client/css/style.css` | Preview layers KEEP / DROP / VAD |
| `tests/cache.test.js` | **Create.** Cache key + hit/miss + no partial publish |
| `tests/edl.test.js` | **Create.** EDL + remap fixtures from spec |
| `tests/run.test.js` | **Create.** Analyze/Build orchestration with fakes |
| `docs/ROADMAP.md` | Add v0.3.8 pipeline slice (do not replace v0.4 zoom) |
| `package.json` | Bump to `0.3.8`; add `"test": "node --test tests/*.test.js"` |

---

### Task 1: VECache

**Files:**
- Create: `client/js/cache.js`
- Create: `tests/cache.test.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: Node `fs`, `path`, `os`, `crypto`
- Produces:
  - `VECache.normalizePath(p) -> string` (backslash → `/`)
  - `VECache.keyFromClips(clips) -> string` SHA-1 hex. Each clip line: `norm(media)|src_i.toFixed(3)|src_o.toFixed(3)|mtimeMs`. Joined by `\n` in probe order (not re-sorted). Missing file → `mtimeMs = 0`.
  - `VECache.dirFor(key) -> string` = `path.join(os.homedir(), ".v-edit", "cache", key)`
  - `VECache.read(key) -> { meta, wavPath, scribe, vad }` — missing files are `null` / `wavPath` null if `timeline.wav` absent
  - `VECache.writeMeta(key, meta)`, `writeJson(key, name, obj)`, `writeWav(key, srcPath)` — publish only complete files; `writeWav` copies into `dirFor(key)/timeline.wav`
  - `VECache.sessionFallbackDir() -> string` under `os.tmpdir()` when durable write fails

- [ ] **Step 1: Write the failing tests**

```js
// tests/cache.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cache.test.js`
Expected: FAIL — `Cannot find module '../client/js/cache.js'`

- [ ] **Step 3: Implement `client/js/cache.js`**

```js
var VECache = (function () {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var crypto = require("crypto");

  var api = { _root: path.join(os.homedir(), ".v-edit", "cache") };

  function normalizePath(p) { return String(p || "").replace(/\\/g, "/"); }
  api.normalizePath = normalizePath;

  api.keyFromClips = function (clips) {
    var lines = (clips || []).map(function (c) {
      var mt = c.mtimeMs;
      if (mt == null) {
        try { mt = fs.statSync(c.media).mtimeMs; } catch (e) { mt = 0; }
      }
      return normalizePath(c.media) + "|" + Number(c.src_i).toFixed(3) + "|"
        + Number(c.src_o).toFixed(3) + "|" + mt;
    });
    return crypto.createHash("sha1").update(lines.join("\n")).digest("hex");
  };

  api.dirFor = function (key) { return path.join(api._root, key); };

  api.read = function (key) {
    var dir = api.dirFor(key);
    function json(name) {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
      catch (e) { return null; }
    }
    var wav = path.join(dir, "timeline.wav");
    return {
      meta: json("meta.json"),
      wavPath: fs.existsSync(wav) ? wav : null,
      scribe: json("scribe.json"),
      vad: json("vad.json")
    };
  };

  function ensure(key) {
    var dir = api.dirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  api.writeMeta = function (key, meta) {
    fs.writeFileSync(path.join(ensure(key), "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  };
  api.writeJson = function (key, name, obj) {
    fs.writeFileSync(path.join(ensure(key), name), JSON.stringify(obj, null, 2), "utf8");
  };
  api.writeWav = function (key, srcPath) {
    var dest = path.join(ensure(key), "timeline.wav");
    fs.copyFileSync(srcPath, dest);
    return dest;
  };
  api.sessionFallbackDir = function () {
    return path.join(os.tmpdir(), "vedit-cache-session");
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cache.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/js/cache.js tests/cache.test.js
git commit -m "feat: add VECache keyed by clip path, in/out, mtime"
```

---

### Task 2: VEEdl (map, records, remap — no VAD subtract)

**Files:**
- Create: `client/js/edl.js`
- Create: `tests/edl.test.js`
- Modify: `client/js/takeselect.js` — replace local `mapToSource` with `VEEdl.mapToSource` (after Task 2 tests pass; HTML script order in Task 5)

**Interfaces:**
- Consumes: none (pure)
- Produces:
  - `VEEdl.mapToSource(clips, tA, tB) -> [{media, srcIn, srcOut}]` — same algorithm as current `takeselect.js` (concat of `src_o - src_i`, not `tl_s/tl_e`)
  - `VEEdl.recordsFromKept(clips, kept) -> string[]` — each `"media;srcIn;srcOut"` with `/` paths and 3 decimals. **Does not take VAD gaps.**
  - `VEEdl.remapWords(words, kept) -> [{text,start,end,type}]` — word concat time `t` inside keep `[a,b]` → CLEAN start/end shifted by sum of previous keep durations; words outside all keeps dropped

- [ ] **Step 1: Write the failing tests**

```js
// tests/edl.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/edl.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `client/js/edl.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/edl.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Point `takeselect.js` `mapToSource` at `VEEdl`**

Replace the local `function mapToSource` body in `client/js/takeselect.js` with:

```js
function mapToSource(clips, tA, tB) { return VEEdl.mapToSource(clips, tA, tB); }
```

Leave `doSelect` / `doBuild` otherwise unchanged in this task.

- [ ] **Step 6: Commit**

```bash
git add client/js/edl.js client/js/takeselect.js tests/edl.test.js
git commit -m "feat: extract VEEdl map/remap; Build never subtracts VAD"
```

---

### Task 3: Parallel extract into cache

**Files:**
- Modify: `client/js/audio.js`
- Create: `tests/audio.test.js` (logic only: concurrency helper + fail-does-not-publish)

**Interfaces:**
- Consumes: `VECache.writeWav` (Task 1)
- Produces:
  - `VEAudio.extractTimelineWav(clips, opts)` — `opts.outDir` optional. `opts.concurrency` default 4. Returns `{ wav, cleanup, extract_ms }`.
  - On any clip `ffmpeg` failure: throw, do not copy a partial concat into the cache dir. `cleanup` still deletes temp parts.
  - If `opts.outDir` set, final wav is `path.join(opts.outDir, "timeline.wav")` written only after concat succeeds.
  - Sequential fallback: if `cp.spawn` is missing, use existing `spawnSync` loop.

- [ ] **Step 1: Extract a tiny concurrency helper and test it**

Add to `audio.js` (exported):

```js
function runPool(items, limit, worker) {
  // worker(item, i) -> Promise
  // reject immediately if any worker rejects; do not start new work after reject
}
```

Test in `tests/audio.test.js`:

```js
var test = require("node:test");
var assert = require("node:assert/strict");
// load audio.js — it requires child_process; that is fine in Node
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/audio.test.js`
Expected: FAIL — `runPool` not exported / module has no exports yet

- [ ] **Step 3: Implement `runPool` + parallel extract**

In `audio.js`:
1. Add `module.exports` of the existing API plus `runPool`.
2. Replace the `forEach` + `ffmpeg(spawnSync)` loop with:
   - Create temp dir
   - `runPool(clips, opts.concurrency || 4, spawn ffmpeg -ss/-to per clip)`
   - Then one concat `spawnSync` (or spawn) into `timeline.wav`
   - Only then, if `opts.outDir`, `fs.copyFileSync` / write there
3. Keep `parseProbe` and `snap` unchanged.

`ffmpeg` spawn args stay identical to current:

```
-hide_banner -loglevel error -y -ss <src_i> -to <src_o> -i <media> -vn -ac 1 -ar 16000 <seg>
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/audio.test.js tests/cache.test.js tests/edl.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/js/audio.js tests/audio.test.js
git commit -m "feat: parallel ffmpeg extract; publish wav only after concat succeeds"
```

---

### Task 4: VERun orchestration (Analyze / Build)

**Files:**
- Create: `client/js/run.js`
- Create: `tests/run.test.js`

**Interfaces:**
- Consumes: `VECache`, `VEEdl`, injected `deps` so tests do not call Premiere/Scribe
- Produces:
  - `VERun.analyze(cfg, log, deps) -> Promise<result>`
  - `VERun.build(cfg, log, deps) -> Promise<result>`
  - In-memory last result: `VERun.getSession() -> { key, name, probe, kept, dropped, vad, words, timings } | null`

`deps` (all required in tests; production wires real ones in Task 5):

```js
{
  probe: async function () { return { name, fps, clips, err? }; },
  extract: async function (clips, outDir) { return { wav, extract_ms }; },
  vad: async function (wavPath) { return { gaps: [[s,e], ...], vad_ms }; },
  scribe: async function (wavPath) { return { words: [], scribe_ms }; },
  takeSelect: async function (segs, cfg) { return { keep: [{from_index,to_index,reason}], dropped_count }; },
  buildClean: async function (planStr) { return "ok|placed=N|failed=0|dur=S"; },
  snapshotRaw: async function () { return "count|end"; },
  placeCaptions: async function () { return { ok: 0, fail: 0 }; }
}
```

Analyze rules (copy verbatim into implementation):

1. `probe()`. If `err` or no clips → throw that message. No cache write.
2. Attach `mtimeMs` per clip via `fs.statSync` (0 if missing). `key = VECache.keyFromClips(clips)`.
3. If no `cfg.elevenKey` or no `cfg.anthropicKey`: if cache lacks both wav and scribe → throw `"set the ElevenLabs and Anthropic API keys (Settings)"` before extract. If wav exists and only Claude is needed, skip extract/Scribe and fail on Claude if key missing (`"set the Anthropic API key (Settings)"`).
4. Cache read. If no wav: `extract` into a **temp** dir; on success `VECache.writeWav` + `writeMeta`. On extract throw: do not `writeWav`.
5. VAD and Scribe in parallel (`Promise.all`). Skip VAD if `vad.json` present; skip Scribe if `scribe.json` present. Persist each when newly computed.
6. `VECaptions.groupCues(words, { maxGap: 0.6, maxChars: 80, maxDur: 12 })` — inject `groupCues` via deps in tests (`deps.groupCues`).
7. Claude `takeSelect`. Map keep indices → `{start,end,reason}` like current `takeselect.js`.
8. Save `~/.v-edit/last-edl.json` as `{ source, kept, records }` where `records = VEEdl.recordsFromKept` (no VAD).
9. Log timings: `extract_ms vad_ms scribe_ms claude_ms` and `cache_hit` when wav+scribe both came from disk.
10. No host mutator.

Build rules:

1. Session null → throw `"run Analyze first"`.
2. Re-probe. If `name !== session.name` or `VECache.keyFromClips(liveClips) !== session.key` → throw `"sequence changed — re-Analyze"`.
3. `records = VEEdl.recordsFromKept(session.probe.clips, session.kept)` — **ignore `session.vad`**.
4. Optional: `deps.snapshotRaw()` before build; store on session for manual compare (do not mutate).
5. `buildClean(plan)`. Log `build_ms`.
6. Remap words via `VEEdl.remapWords`. Call `deps.setTranscript(remapped, fps)` then `deps.placeCaptions`. If place throws or returns fails: log, do not rollback CLEAN. Log `captions_ms`.
7. Missing `cfg.mogrtPath`: skip `placeCaptions`, log `"skip captions: no .mogrt"`.

- [ ] **Step 1: Write failing tests**

```js
// tests/run.test.js
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
    groupCues: function (words) { return [{ start: 1, end: 2, text: "ก" }]; },
    takeSelect: async function () { return { keep: [{ from_index: 0, to_index: 0, reason: "hook" }], dropped_count: 0 }; },
    buildClean: async function (plan) { d._plan = plan; return "ok|placed=1|failed=0|dur=20"; },
    snapshotRaw: async function () { return "1|20"; },
    setTranscript: function (w) { d._words = w; },
    placeCaptions: async function () { return { ok: 1, fail: 0 }; }
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
  var logs = [];
  await VERun.analyze({ elevenKey: "e", anthropicKey: "a" }, function (s) { logs.push(s); }, d);
  await VERun.build({ mogrtPath: "C:/x.mogrt" }, function () {}, d);
  assert.match(d._plan, /0\.000;20\.000/);
  assert.ok(!/0\.000;10\.000/.test(d._plan) || d._plan.indexOf("10.000;20.000") === -1);
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
```

The second assertion: plan must be one record `E:/a.mp4;0.000;20.000` (full keep), not split at 10–12.

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

- [ ] **Step 3: Implement `client/js/run.js`** following the rules above. Export `analyze`, `build`, `getSession`, `reset`. Use `module.exports`.

- [ ] **Step 4: Run `node --test tests/run.test.js`** — PASS

- [ ] **Step 5: Commit**

```bash
git add client/js/run.js tests/run.test.js
git commit -m "feat: VERun Analyze/Build; VAD preview-only; refuse stale sequence"
```

---

### Task 5: Run tab UI

**Files:**
- Modify: `client/index.html`
- Modify: `client/css/style.css`
- Modify: `client/js/main.js`
- Modify: `CSXS/manifest.xml` — only if version attribute should match 0.3.8 (do the bump in Task 8; UI can ship with current version until then)

**Interfaces:**
- Consumes: `VERun`, `VECache`, `VEAudio`, `VEVad`, `VEProviders`, `VECaptions`, `VEEdl`, `VEConfig`, `CSInterface`
- Produces: tab `data-tab="run"` is first and default `active`

- [ ] **Step 1: HTML**

In `client/index.html`:
1. Add `<script src="js/cache.js">`, `edl.js`, `run.js` before `main.js` (after existing helpers).
2. Insert Run as the first tab and first panel (make it `active`; remove `active` from Auto-Cut).

```html
<button class="tab active" data-tab="run">Run</button>
```

```html
<section class="panel active" id="tab-run">
  <p class="hint">Analyze อ่านอย่างเดียว แล้วหยุดให้ดู take. Build สร้าง sequence ใหม่ "… - CLEAN" + แคปชัน. ไม่แตะดิบ. ชั้น VAD โชว์อย่างเดียว ไม่ถูกตัดตอน Build.</p>
  <button id="btn-analyze" class="primary">1 · Analyze</button>
  <div id="run-preview" class="preview" hidden></div>
  <button id="btn-run-build" class="primary" disabled>2 · Build CLEAN + Captions</button>
  <pre id="runlog" class="log"></pre>
</section>
```

- [ ] **Step 2: CSS for layered preview**

```css
.preview { margin: 10px 0; padding: 8px; background: #1c1c1c; border: 1px solid #333; border-radius: 3px; max-height: 180px; overflow: auto; font-family: Consolas, monospace; font-size: 11px; }
.layer-keep { color: #8fbf8f; }
.layer-drop { color: #d08080; }
.layer-vad { color: #e0c36a; }
```

- [ ] **Step 3: Wire `main.js`**

Production `deps` for `VERun.analyze` / `build`:

- `probe`: `VEAudio.parseProbe(await evalHost("ve_probeSequence()"))`
- `extract`: `VEAudio.extractTimelineWav(clips, { outDir: tmpThenCache })` — Analyze should extract to temp, then `VECache.writeWav` (already in VERun)
- `vad`: `VEVad.silenceGaps(fs.readFileSync(wav), cfg)` → `{ gaps: res.gaps, vad_ms }`
- `scribe`: `VEProviders.scribe(...)`
- `groupCues`: `VECaptions.groupCues`
- `takeSelect`: `VEProviders.takeSelect`
- `buildClean`: `evalHost("ve_buildCleanSeq(" + JSON.stringify(plan) + ")")`
- `snapshotRaw`: `evalHost("ve_snapshotLockedCut()")`
- `setTranscript`: `VECaptions.setTranscript` (Task 7 — stub in Task 5 if Task 7 not done yet: `function (w, fps) { /* set in Task 7 */ }`)
- `placeCaptions`: `VECaptions.doGenerate(cfg, rlog)`

UI behavior:
- Both buttons `disabled = true` while a job runs.
- After successful Analyze: enable Build; fill `#run-preview` with KEEP / DROP / VAD lines (`layer-keep`, `layer-drop`, `layer-vad`).
- Build stays disabled until Analyze succeeds for this session.

- [ ] **Step 4: Manual panel smoke (no Premiere mutation)**

Open the panel (or just open `client/index.html` in a browser — CSInterface will fail ping; that is OK). Confirm 5 tabs, Run first, Build disabled.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/css/style.css client/js/main.js
git commit -m "feat: add Run tab Analyze/Build preview (VAD annotated)"
```

---

### Task 6: Old tabs reuse cache

**Files:**
- Modify: `client/js/takeselect.js` `doSelect`
- Modify: `client/js/captions.js` `doTranscribe`
- Modify: `client/js/main.js` Auto-Cut path

**Interfaces:**
- Consumes: `VECache.keyFromClips` + `read`
- Produces: log line `cache_hit wav` / `cache_hit scribe` when skipped

- [ ] **Step 1: Take-Select `doSelect`**

After probe + mtimes + key:
- If `VECache.read(key).scribe` and `.wavPath`: skip extract+Scribe; use cached words.
- Else if `.wavPath` only: skip extract; Scribe as now; `writeJson` scribe.
- Else: existing extract+Scribe; then write cache (wav + scribe) so a later Run Analyze hits.

- [ ] **Step 2: Captions `doTranscribe`**

Same key check. If scribe hit **and** key matches active sequence: set in-memory transcript from cache, do not call Scribe. Log `cache_hit scribe`.

- [ ] **Step 3: Auto-Cut in `main.js`**

If wav hit: `VEVad.silenceGaps(fs.readFileSync(wavPath), cfg)` and skip `extractTimelineWav`. Still call `ve_autoCutSilence` (user chose this tab). Log `cache_hit wav`.

- [ ] **Step 4: Add a unit test that `doSelect` path is too heavy for Node (Premiere). Instead test a small helper:**

Add `VECache.hitKind(readResult) -> "none"|"wav"|"scribe"|"both"` and test it in `tests/cache.test.js`. Use that helper in the three call sites so the skip condition is not duplicated ad hoc.

```js
api.hitKind = function (r) {
  if (r.wavPath && r.scribe) return "both";
  if (r.scribe) return "scribe";
  if (r.wavPath) return "wav";
  return "none";
};
```

- [ ] **Step 5: Commit**

```bash
git add client/js/cache.js client/js/takeselect.js client/js/captions.js client/js/main.js tests/cache.test.js
git commit -m "feat: old tabs reuse VECache (skip extract/Scribe on hit)"
```

---

### Task 7: Captions `setTranscript` + remap on Build

**Files:**
- Modify: `client/js/captions.js`
- Modify: `client/js/run.js` production already calls `deps.setTranscript` (Task 4)
- Modify: `client/js/main.js` wire `VECaptions.setTranscript` / `doGenerate`

**Interfaces:**
- Consumes: `VEEdl.remapWords`
- Produces: `VECaptions.setTranscript(words, fps)` sets the same in-memory `transcript` that `doGenerate` already reads

- [ ] **Step 1: Add `setTranscript` to the captions IIFE export**

```js
function setTranscript(words, fps) {
  transcript = { words: words || [], fps: fps };
}
return { groupCues: groupCues, doTranscribe: doTranscribe, doGenerate: doGenerate, setTranscript: setTranscript };
```

- [ ] **Step 2: `doGenerate` skip when no mogrt**

Keep existing throw if called from the Captions tab with no mogrt. Run Build must **not** call `doGenerate` when `!cfg.mogrtPath` (already in Task 4). No change to host snapshot / `ve_placeCaption`.

- [ ] **Step 3: Confirm `tests/run.test.js` still passes** with remapped words stored on `deps._words`.

Add:

```js
test("setTranscript receives remapped word inside keep", async function () {
  VERun.reset();
  var d = deps();
  await VERun.analyze({ elevenKey: "e", anthropicKey: "a" }, function () {}, d);
  await VERun.build({ mogrtPath: "C:/x.mogrt" }, function () {}, d);
  assert.equal(d._words[0].text, "ก");
});
```

- [ ] **Step 4: Commit**

```bash
git add client/js/captions.js tests/run.test.js client/js/main.js
git commit -m "feat: inject remapped Scribe words into captions after CLEAN build"
```

---

### Task 8: Timings, docs, version, Premiere verification

**Files:**
- Modify: `package.json` version `0.3.8`; add `"test": "node --test tests/*.test.js"`
- Modify: `CSXS/manifest.xml` `ExtensionBundleVersion` and `Extension Version` to `0.3.8`
- Modify: `docs/ROADMAP.md`
- Modify: `README.md` Use section — one paragraph on Run tab

**Interfaces:** none new

- [ ] **Step 1: ROADMAP — insert before v0.4, do not rename v0.4**

```markdown
## v0.3.8 — One-pass Run tab
- New Run tab: Analyze (extract + VAD + Scribe + Claude, preview) → Build CLEAN + Captions.
- Disk cache `~/.v-edit/cache/<key>/`. Old tabs reuse wav/scribe.
- Parallel ffmpeg extract. Raw sequence never mutated from Run.
- VAD is preview-only; silence tightening stays on the Auto-Cut tab (use on CLEAN).
```

- [ ] **Step 2: Bump versions** in `package.json` and `manifest.xml` to `0.3.8`. Add npm test script.

- [ ] **Step 3: Run full Node suite**

Run: `npm test`
Expected: all of `tests/*.test.js` PASS

- [ ] **Step 4: Premiere manual checklist (do not claim 2× until logs exist)**

On a real talking-head sequence (AOZOOM or equivalent):

1. Snapshot raw: note V1 clip count and last end.
2. Run → Analyze. Confirm preview shows KEEP / DROP / VAD. Confirm log has `extract_ms` `vad_ms` `scribe_ms` `claude_ms`. Target: ~10 min speech → Analyze ≤ ~2 min.
3. Run → Build. New `… - CLEAN` exists. Raw V1/A1 count+end unchanged.
4. Scrub CLEAN: speech eaten only where preview showed Claude DROP, not VAD-only gaps.
5. Second Analyze on same sequence: log `cache_hit`; extract/Scribe skipped.
6. Optional: Captions tab Transcribe on the same raw → `cache_hit scribe`.
7. Compare wall clock of this Run vs old 3×extract+2×Scribe path; record both totals in the Run log. Do not bump README with “2×” unless the ratio is ≥ 2.

- [ ] **Step 5: Commit**

```bash
git add package.json CSXS/manifest.xml docs/ROADMAP.md README.md
git commit -m "docs: v0.3.8 one-pass Run tab; add npm test"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Run tab, 2 clicks, preview gate | 5 |
| Never touch raw / no `ve_autoCutSilence` | 4, 5 |
| VAD preview only, not in EDL | 2, 4 |
| Cache key path+in/out+mtime | 1 |
| Parallel ffmpeg, no partial publish | 3 |
| Analyze VAD ∥ Scribe, timings | 4 |
| Build remap words + captions | 4, 7 |
| Refuse Build if sequence changed | 4 |
| Caption fail leaves CLEAN | 4 |
| Old tabs cache hit | 6 |
| Success metrics / Premiere measure | 8 |
| ROADMAP + 0.3.8 | 8 |
| Host JSX unchanged | all |

## Execution

After this plan is approved:

**1. Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks

**2. Inline Execution** — same session, `executing-plans`, checkpoints after each task

Work in `E:\Claude-Workspace\V-Edit` only — not `%APPDATA%\Adobe\CEP\extensions\V-Edit` and not `E:\Grok-Silver`. After 0.3.8 ships, sync source → CEP so Premiere loads the new panel. Reload the panel after client JS changes; full Premiere restart if Node cache looks stale.
