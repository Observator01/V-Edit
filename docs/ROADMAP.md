# V-Edit Roadmap

Each milestone is shippable on its own. Ports the proven `video-agent` workflow
into the extension, one tab at a time.

## v0.1 — Auto-Cut Silence ✅ (this release)
- CEP scaffold, panel UI, local config (keys + thresholds).
- Silero VAD (onnxruntime-node), Thai-particle tail-pad.
- Ripple-cut on V1+A1, frame-snapped, re-probe guard.

## v0.2 — Transcribe + Captions
- ElevenLabs Scribe (Thai, word-level) from the panel (user key).
- Clean Thai SRT: word-safe wrap (pythainlp-equivalent), spoken-number→digit.
- MOGRT captions: user exports their styled `.mogrt` once → V-Edit places on
  V2/V3 timed to lines + sets text (`setValue`), **additive** (V1/A1 untouched).

## v0.3 — AI take-select + Learning
- Claude reads the transcript → selects best takes (drop retakes/bloopers),
  curate to target length. Few-shot prompt seeded from the **learning corpus**.
- **Learning analyzer** (see LEARNING.md): ingest the user's finished `.prproj`
  → style profile + correction corpus → tune thresholds, prompts, caption defaults.

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
