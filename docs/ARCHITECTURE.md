# V-Edit Architecture

## Tech choice: CEP now, UXP later

V-Edit is a **CEP** extension. Adobe is moving to **UXP** (the future; CEP is
deprecated, security-only after CEP 12), but every editing operation V-Edit needs
was already proven working via ExtendScript in Premiere 26.2 this project's
research phase. CEP runs that ExtendScript directly, so v0.1 ships reliably.
UXP migration is roadmap v1.0 (async API, non-blocking UI).

## Two layers

```
┌─ client/ (panel: HTML + JS + Node) ─────────────┐      ┌─ host/ (ExtendScript) ─┐
│ UI (tabs), config, orchestration                │      │ probe.jsx   (read)     │
│ Silero VAD (onnxruntime-node)        evalScript  │ ───► │ edit-ops.jsx (mutate)  │
│ ffmpeg audio extract (system)        ◄────────── │      │ index.jsx (helpers)    │
│ ElevenLabs / Anthropic REST (v0.2+)   strings    │      │ frame-snap, fps        │
└─────────────────────────────────────────────────┘      └────────────────────────┘
```

- **All Premiere mutations live in `host/` ExtendScript.** The panel never edits
  the timeline directly — it asks the host via `CSInterface.evalScript`.
- Host functions return **pipe/newline-delimited strings**, not JSON (the
  ExtendScript `JSON` object is unreliable across Premiere builds).

## Non-negotiable editing rules (baked into host/)

These come from real failures (see the skill `editing-thai-product-videos`):

1. **Frame-snap** every cut/placement to the sequence fps (`round(t*fps)/fps`) —
   sub-frame ops leave 1-frame slivers. fps derived from `sequence.timebase`.
2. **Never touch the locked cut.** Destructive ops are scoped to V1+A1 of the
   active sequence; additive ops (captions, v0.2) go on V2+ only. Snapshot
   V1/A1 (count + last end) before/after — must be identical for additive ops.
3. **Re-probe before every mutation.** Users switch projects/sequences constantly;
   confirm the active sequence first.
4. **MOGRT text** (captions, v0.2) via `clip.components[<Text>].properties[0].setValue(str, true)`.
   `getMGTComponent()` returns null in Premiere 26.x — don't rely on it.
5. **No frame export** from Premiere (`exportFramePNG` undefined) → the user
   verifies visually by scrubbing. The panel reports what it changed.

## AI: client-side, user keys

No server. The panel calls providers directly with the user's own keys (stored in
`~/.v-edit/config.json`). Transcription = ElevenLabs Scribe (Thai WER 3.1%, beats
Whisper 4.2% / Groq). VAD = Silero (local onnxruntime-node). Take-select = Claude.

## Auto-Cut Silence data flow (v0.1)

`probe active seq → per-V1-clip ffmpeg extract [src_in,src_out] @16k mono →
concat = timeline WAV → Silero VAD (Thai tail-pad) → silence gaps (timeline time)
→ host ripple-cut (frame-snapped, back-to-front, V1+A1)`. Assumes contiguous V1.
