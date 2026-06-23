# V-Edit Roadmap

Each milestone is shippable on its own. Ports the proven `video-agent` workflow
into the extension, one tab at a time.

## v0.1 — Auto-Cut Silence ✅ (this release)
- CEP scaffold, panel UI, local config (keys + thresholds).
- Silero VAD (onnxruntime-node), Thai-particle tail-pad.
- Ripple-cut on V1+A1, frame-snapped, re-probe guard.

## v0.2 — Transcribe + Captions ✅ (this release)
- ElevenLabs Scribe (Thai, word-level) from the panel (user key).
- Cue grouping: break at pauses (never mid-word), cap chars/dur.
- MOGRT captions: user exports their styled `.mogrt` once → V-Edit places on the
  chosen track (V2/V3) timed to cues + sets text (`setValue`), **additive**
  (V1/A1 untouched, verified via before/after snapshot).
- TODO next: spoken-number→digit, 2-color (white+orange) stacking.

## v0.3 — AI take-select + Learning ✅ (this release)
- Claude (user key) reads the Scribe transcript → selects best takes (drops
  retakes/false-starts/bloopers), curates to a target length, then builds a NEW
  `… - CLEAN` sequence (clone→clear→place, frame-snapped). The raw cut is never touched.
- **Learning analyzer**: reads the user's finished sequence read-only (in-Premiere, no
  `.prproj` parsing) → `style-profile.json` (target length, segment rhythm, the pauses
  the editor cuts, caption cadence, b-roll coverage) → seeds the take-select prompt.
- Two-step UX (Select preview → Build) mirrors the proven `--dry` caution. The auto-EDL
  is saved to `~/.v-edit/last-edl.json` to seed the future "learn from corrections" diff.
- TODO next: full mistake-diff loop (auto-EDL vs the user's corrected final).

## v0.4 — Repeat detection + Auto-Zoom
- Detect duplicate/restarted phrases → suggest cuts.
- Auto punch-in/zoom on emphasis beats. (Matches the reference panel's tabs.)

## v1.0 — UXP + distribution
- Port host ops to the UXP `@adobe/premierepro` API (async, non-blocking).
- Verify MOGRT/clip-placement parity; fall back to documented gaps.
- Package signed `.zxp`; list on Adobe Exchange.

## Principle
AI does the **tedious mechanical** work; the human does the **creative** work.
Automated *visual* editing (auto b-roll) stays in R&D until it clears a
pro-editor bar — see the parent skill's `rd-notes.md`.
