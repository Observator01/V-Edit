/*
 * V-Edit — Silero VAD (onnxruntime-node). Ported from video-agent/vad_silero.py.
 * Neural speech detection (keeps soft Thai final particles that energy-threshold
 * silencedetect clips). Returns SILENCE gaps (to ripple-cut).
 *
 * Requires: vendor/silero_vad.onnx (Silero v5) + `onnxruntime-node` (package.json).
 * Audio: 16 kHz mono Float32.
 */
var VEVad = (function () {
  var SR = 16000;
  var WIN = 512;             // Silero v5 window @ 16 kHz (32 ms)

  // ---- WAV (16 kHz mono PCM16) -> Float32 ----
  function decodeWav(buf) {
    // minimal RIFF/WAVE parse; expects PCM16 mono 16k (we extract it that way)
    if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not RIFF");
    var off = 12, dataOff = -1, dataLen = 0, ch = 1, rate = SR, bits = 16;
    while (off + 8 <= buf.length) {
      var id = buf.toString("ascii", off, off + 4);
      var sz = buf.readUInt32LE(off + 4);
      if (id === "fmt ") {
        ch = buf.readUInt16LE(off + 10);
        rate = buf.readUInt32LE(off + 12);
        bits = buf.readUInt16LE(off + 22);
      } else if (id === "data") { dataOff = off + 8; dataLen = sz; break; }
      off += 8 + sz + (sz & 1);
    }
    if (dataOff < 0) throw new Error("no data chunk");
    if (bits !== 16) throw new Error("expected PCM16");
    var n = Math.floor(dataLen / 2 / ch);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOff + i * 2 * ch) / 32768;
    return { samples: out, rate: rate };
  }

  // ---- Silero state machine -> speech timestamps (seconds) ----
  async function speechTimestamps(samples, opts) {
    var ort = require("onnxruntime-node");
    var path = require("path");
    var modelPath = path.join(__dirname, "..", "..", "vendor", "silero_vad.onnx");
    var sess = await ort.InferenceSession.create(modelPath);

    var threshold = opts.threshold;
    var negThr = threshold - 0.15;
    var minSilence = Math.round(opts.minSilence * SR);
    var minSpeech = Math.round(0.20 * SR);
    var state = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
    var srT = new ort.Tensor("int64", BigInt64Array.from([BigInt(SR)]), [1]);

    var triggered = false, tempEnd = 0, speeches = [], cur = null;
    for (var start = 0; start + WIN <= samples.length; start += WIN) {
      var chunk = samples.subarray(start, start + WIN);
      var input = new ort.Tensor("float32", Float32Array.from(chunk), [1, WIN]);
      var out = await sess.run({ input: input, state: state, sr: srT });
      var prob = out.output.data[0];
      state = out.stateN || out.state || state;
      var winEnd = start + WIN;

      if (prob >= threshold && tempEnd) tempEnd = 0;
      if (prob >= threshold && !triggered) { triggered = true; cur = { start: start }; }
      if (prob < negThr && triggered) {
        if (!tempEnd) tempEnd = winEnd;
        if (winEnd - tempEnd >= minSilence) {
          cur.end = tempEnd;
          if (cur.end - cur.start >= minSpeech) speeches.push(cur);
          cur = null; triggered = false; tempEnd = 0;
        }
      }
    }
    if (cur && triggered) { cur.end = samples.length; if (cur.end - cur.start >= minSpeech) speeches.push(cur); }
    return speeches.map(function (s) { return { start: s.start / SR, end: s.end / SR }; });
  }

  // ---- public: WAV buffer -> SILENCE gaps (seconds) ----
  async function silenceGaps(wavBuffer, opts) {
    var cfg = Object.assign({ threshold: 0.5, minSilence: 0.4, tailPad: 0.25, headPad: 0.08, mergeGap: 0.2 }, opts || {});
    var w = decodeWav(wavBuffer);
    var dur = w.samples.length / SR;
    var speech = await speechTimestamps(w.samples, cfg);

    // asymmetric pad (protect Thai final particles) + clamp
    var keep = speech.map(function (s) {
      return [Math.max(0, s.start - cfg.headPad), Math.min(dur, s.end + cfg.tailPad)];
    });
    // merge near-overlapping keeps
    var merged = [];
    for (var i = 0; i < keep.length; i++) {
      if (merged.length && keep[i][0] - merged[merged.length - 1][1] <= cfg.mergeGap)
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], keep[i][1]);
      else merged.push(keep[i]);
    }
    // silence = complement of keep
    var gaps = [], cursor = 0;
    for (var j = 0; j < merged.length; j++) {
      if (merged[j][0] > cursor + 0.05) gaps.push([cursor, merged[j][0]]);
      cursor = merged[j][1];
    }
    if (dur > cursor + 0.05) gaps.push([cursor, dur]);
    return { duration: dur, keep: merged, gaps: gaps };
  }

  return { silenceGaps: silenceGaps, decodeWav: decodeWav };
})();
