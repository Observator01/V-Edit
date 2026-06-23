# Learning from your edits

V-Edit's edge: it studies **your finished edits** and the **corrections you make**
to its auto-output, so its next edit matches your style — and stops repeating your
past mistakes. Everything stays local.

## What it ingests

A finished Premiere sequence (read-only) yields, per V1 clip:
`timeline position · source in/out · which raw take was kept vs cut`, plus from the
upper tracks: `b-roll placement (which timeline ranges got covered) · caption
style/timing/text`. Compared against the raw recording, this reveals the editor's
decisions, not just the result.

## What it learns (and where it feeds back)

| Signal extracted | Feeds |
|---|---|
| Kept vs cut source ranges, pause lengths tolerated | VAD threshold / min-silence / tail-pad defaults |
| Which takes chosen when several exist | take-select few-shot prompt (Claude, v0.3) |
| Where b-roll covers the talking head | b-roll suggestion timing (R&D) |
| Caption wording / line-split / timing offset | caption defaults + MOGRT placement (v0.2) |
| Target length, section rhythm (hook→specs→CTA) | curation budget |

## Learning from mistakes

When V-Edit produces an auto-edit and the editor **corrects it** (re-cuts, moves a
caption, restores a take), V-Edit diffs *its output* vs *the editor's final* and
records the correction. A pattern of corrections updates the defaults/prompts —
e.g. "user always restores the 0.3s pause before a number" → raise min-silence near
spoken numbers.

## Initial corpus (already available)

Two real edits from this project's build phase, to seed v0.3:
- TANK500 `… - CLEAN` — 22-clip tight talking-head cut + white/orange MOGRT captions.
- EV-ranking `… - SHORT` — listicle with hand-built graphic overlays (the caption
  style later exported as `.mogrt`).

The analyzer (v0.3) reads these read-only, extracts the table above, and writes a
`style-profile.json` consumed by the take-select + caption stages.

## Privacy

Analysis runs locally; the corpus and profile never leave the machine. No telemetry.
