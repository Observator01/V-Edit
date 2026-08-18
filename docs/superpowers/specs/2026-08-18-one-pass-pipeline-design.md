# V-Edit one-pass pipeline

Date: 2026-08-18
Status: draft for user review
Scope: pipeline efficiency only (not take-select quality, caption polish, auto-zoom, or UXP)

## Problem

V-Edit 0.3.7 already does Auto-Cut, Take-Select, Transcribe, and MOGRT captions as separate tabs. A real talking-head pass is five clicks and repeats expensive work:

- `VEAudio.extractTimelineWav` runs once per tab (sequential `ffmpeg` per V1 clip)
- ElevenLabs Scribe runs in Take-Select and again in Captions
- Auto-Cut ripple-cuts the **active** sequence (destructive on raw V1+A1)

The editor's time is lost to waiting and to not knowing whether a missing syllable was VAD, Claude, or a stacked cut.

## Goal

One-pass with a single preview gate:

1. **Analyze** — extract + VAD + Scribe + Claude, then stop
2. **Build CLEAN + Captions** — new sequence only; raw never mutates

Success (must all hold):

| Metric | Target |
|---|---|
| Clicks | 2 (Analyze → Build) |
| Analyze on ~10 min talking-head | ≤ ~2 minutes wall clock (Scribe API is the ceiling) |
| Full path vs current | ≥ 2× faster on a real project (e.g. AOZOOM), measured from logs |
| Raw safety | V1/A1 snapshot of the raw sequence identical before/after Run |
| Speech eating | Build EDL = Claude keep ranges only. VAD is preview, not a second cutter |

Out of scope for this spec: better take-select, spoken-number→digit, 2-color captions, repeat-detect, auto-zoom, UXP, auto b-roll.

## UX

New **Run** tab. Old tabs stay.

```
[ Run | Auto-Cut | Take-Select | Captions | Settings ]

1 · Analyze
    preview:
      Claude KEEP / DROP (reason + times)
      VAD silence (annotation only — not applied)
    timings: extract / vad / scribe / claude

2 · Build CLEAN + Captions
```

- Analyze is read-only.
- Build is disabled until a successful Analyze for the **current** sequence cache key.
- Buttons disable while a job runs (no double-fire).
- Missing `.mogrt` or ElevenLabs key: Build still creates CLEAN, skips captions, logs a warning.
- Auto-Cut tab remains the way to actually remove silence — intended use after Build is: activate CLEAN, then Auto-Cut if dead air remains.

## Architecture

```
client/
  run.js      VERun.analyze / VERun.build
  cache.js    VECache  →  ~/.v-edit/cache/<key>/
  audio.js    parallel ffmpeg, write wav into cache
  vad.js      unchanged algorithm; persist vad.json
  takeselect.js / captions.js / main.js
              old tabs read VECache on matching key

host/         unchanged APIs
  probe / ve_buildCleanSeq / ve_placeCaption / ve_snapshotLockedCut
  Run NEVER calls ve_autoCutSilence
```

No sidecar process. Work stays in the CEP panel Node context.

## Cache

Directory: `~/.v-edit/cache/<key>/`

`key` = SHA-1 of a stable string, one line per V1 clip, sorted as probed:

```
<normalized media path>|<src_i to 3 decimals>|<src_o to 3 decimals>|<mtime ms>
```

Files:

| File | Writer | Readers |
|---|---|---|
| `meta.json` | Analyze | Build (must match live probe) |
| `timeline.wav` | extract | VAD, Scribe, old tabs |
| `scribe.json` | Scribe | Claude, caption remap, old Captions/Take-Select |
| `vad.json` | VAD | Run preview only |

Invalidation: any clip path / in-out / mtime change → new key → miss. No silent reuse.

Cache is local only. Never commit. Never upload.

Old tabs:

- Auto-Cut: if wav hit, skip extract; still ripple-cuts the **active** sequence (user chose that tab)
- Take-Select Select: if wav+scribe hit, skip extract+Scribe; still calls Claude
- Captions Transcribe: if scribe hit **and** active sequence key matches, reuse words

## Time axis

Unchanged from current Take-Select:

- Timeline audio is the concatenation of each V1 clip's `[src_i, src_o]`, not sequence `tl_s/tl_e` (gaps on the raw timeline must not shift times)
- VAD gaps, Scribe words, and Claude keep/drop ranges are on this **concat** axis

## Analyze

1. `ve_probeSequence()`. No clips or `ERR:` → stop.
2. Compute key. Load cache if present.
3. If no `timeline.wav`: extract with parallel `ffmpeg` (max 4 concurrent `spawn`, then concat). Sequential fallback if `spawn` is unavailable in the host.
4. Run VAD and Scribe in parallel once wav exists. Skip whichever file is already cached.
5. Group Scribe words with existing `VECaptions.groupCues` (Take-Select line-level settings: maxGap 0.6, maxChars 80, maxDur 12).
6. Claude take-select with existing prompt + `style-profile.json` if present.
7. Preview KEEP / DROP / VAD layers. Persist `last-edl.json` (kept ranges + records **without** VAD subtraction).
8. Log ms for extract, vad, scribe, claude.

Analyze requires ElevenLabs + Anthropic keys (same as today’s Take-Select). Missing either → stop before extract if both cache files are absent; if wav exists and only Claude is missing, skip extract/Scribe and fail on the Claude call.

Analyze does not call any host mutator.

## Build

1. Re-probe. If name or cache key ≠ Analyze snapshot → refuse (“sequence changed — re-Analyze”).
2. If no Analyze result → refuse.
3. Map each Claude keep range through existing `mapToSource` → `media;srcIn;srcOut`.
4. **Do not subtract VAD gaps** from those ranges.
5. `ve_buildCleanSeq(plan)`. Frame-snap stays in host.
6. Remap Scribe words concat → CLEAN timeline:

   For word time `t` on concat: if `t` falls inside a keep `[a,b]`, CLEAN time = sum of previous keep durations + `(t - a)`. Else drop the word.

7. Inject remapped words + CLEAN fps into Captions (new `VECaptions.setTranscript(words, fps)`). Place MOGRT with existing `doGenerate` / host place+snapshot. Active sequence after a successful build is CLEAN (already true of `ve_buildCleanSeq`).
8. Caption failure after CLEAN exists: leave CLEAN, log, do not delete/rollback the sequence.
9. Log ms for build and captions.

## Why VAD is preview-only

Speech has been eaten on real cuts. Three causes are plausible and currently indistinguishable:

1. VAD false silence (soft Thai endings / low energy)
2. Double cut (Claude already dropped pauses, then VAD trims keep edges)
3. Claude dropping lines to hit `targetSecs`

This spec does not guess. Preview attributes each cut. Build applies Claude only. Tightening silence is a separate, visible Auto-Cut on CLEAN.

## Error handling

| Case | Behavior |
|---|---|
| No sequence / empty V1 | Analyze stops; no cache write |
| One `ffmpeg` clip fails | Analyze aborts; no partial wav published as a hit |
| Scribe or Claude fails | Keep wav (and vad if done); retry Analyze skips extract |
| Sequence changed before Build | Refuse |
| Build before Analyze | Refuse |
| No mogrt / no ElevenLabs key on Build | CLEAN yes, captions skip + warn |
| Caption host error mid-loop | Existing per-cue fail count; CLEAN remains |
| Cache write fails | Fall back to temp dir for this session; log; do not pretend it is a durable hit |

## Testing

Measure before claiming speed. Each Analyze/Build writes a timing line to the Run log (`extract_ms`, `vad_ms`, `scribe_ms`, `claude_ms`, `build_ms`, `captions_ms`).

1. **Raw safety** — snapshot raw V1/A1 count + last end before Run and after Build; must match.
2. **No VAD in EDL** — fixture keep `[0,20]` + VAD gap `[10,12]` → placed records cover `0–20` concat, not `0–10` + `12–20`.
3. **Word remap** — word at concat `13` with keep `[0,20]` → CLEAN `13`. Word at `13` with keep `[0,10]+[12,20]` is out of scope (VAD not applied; single keep). Word in a Claude DROP → omitted.
4. **Cache hit** — second Analyze on unchanged clips skips extract and Scribe; log says `cache_hit`.
5. **Cache miss** — change one clip `src_o` or mtime → new key → re-extract.
6. **Old tabs** — after Analyze, Captions Transcribe on the same raw sequence does not call Scribe again.
7. **Manual (AOZOOM or equivalent)** — 2 clicks; Analyze ≤ ~2 min on ~10 min speech; wall clock of Run vs old 3×extract+2×Scribe path ≥ 2×. Record both totals in the Run log.

No Premiere automation in CI. Logic tests (cache key, remap, EDL composition) run in Node against fixtures. Premiere checks are manual from the panel.

## Files to change

| File | Change |
|---|---|
| `client/js/cache.js` | **new** VECache |
| `client/js/run.js` | **new** VERun |
| `client/index.html` | Run tab + preview + two buttons |
| `client/css/style.css` | Run tab / layered preview |
| `client/js/audio.js` | parallel extract; optional output path for cache |
| `client/js/captions.js` | `setTranscript`; reuse cache in `doTranscribe` |
| `client/js/takeselect.js` | reuse cache in `doSelect` |
| `client/js/main.js` | wire Run; Auto-Cut cache wav |
| `client/js/vad.js` | persist/load `vad.json` via VECache |
| `docs/ROADMAP.md` | add this slice (not v0.4 zoom) |
| `package.json` | bump patch (0.3.8) when shipping |

Host JSX: no required change.

## Non-goals (explicit)

- Applying VAD inside Build (rejected: cannot attribute speech-eating)
- Mutating raw from Run
- Replacing old tabs
- Sidecar worker / job queue
- Improving Claude take quality (next spec)
- Caption styling / digits / two-color (later spec)
