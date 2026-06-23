# V-Edit

**AI-assisted Thai video editing for Adobe Premiere Pro.** A downloadable panel
(CEP extension) that does the tedious mechanical edit — cut silences, transcribe,
caption — so you keep the creative work (b-roll, transitions, motion, SFX).

Built on a workflow battle-tested on real Thai talking-head product ads. Designed
to **learn from your finished edits** and get better over time.

> Status: **v0.2 — Auto-Cut Silence + Transcribe + MOGRT Captions.** See [docs/ROADMAP.md](docs/ROADMAP.md).

## What it does (v0.1)

- **Auto-Cut Silence** — neural **Silero VAD** removes dead air from the active
  sequence, frame-snapped (no 1-frame slivers) and **Thai-particle-safe** (keeps
  soft endings มะคะ/มั้ย/ครับ/นะ that energy-threshold tools clip).
- Works only on **V1 + A1** of the active sequence — your upper tracks (captions,
  graphics) are never touched.

Coming: Transcribe (ElevenLabs Scribe, best Thai), MOGRT captions, AI take-select
(Claude), repeat-detection, zoom. See the roadmap.

## Why AI does *some* of the edit, not all

Fully-automated *visual* editing (auto b-roll) was tried and rejected — it can't
match a human editor. V-Edit automates the tedious, deterministic parts and hands
you a tight cut to finish. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install (developer / unsigned)

Requires **Premiere Pro 24+**, **Node-enabled CEP**, **system ffmpeg** on PATH.

1. **Enable unsigned extensions** (one time):
   - Windows: `reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f`
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
2. **Clone into the CEP extensions folder** (or symlink):
   - Windows: `%APPDATA%\Adobe\CEP\extensions\V-Edit`
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/V-Edit`
3. `npm install` (in the V-Edit folder) — installs `onnxruntime-node` and downloads
   the Silero VAD model into `vendor/`.
4. Restart Premiere → **Window ▸ Extensions ▸ V-Edit**.

## Use

1. Open a sequence (a Thai talking-head cut on V1/A1).
2. **Settings** → set thresholds; add API keys for later features.
3. **Auto-Cut** → *Auto-Cut Silence*. Scrub to verify (Thai endings intact, no slivers).

Your API keys live only in `~/.v-edit/config.json` and are sent only to the
provider's own API.

## License

MIT © Observator01
