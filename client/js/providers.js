/*
 * V-Edit — AI providers (client-side REST; user-supplied keys). Stubs wired for
 * v0.2+. ElevenLabs Scribe = best Thai STT (WER 3.1% > Whisper 4.2%). Anthropic
 * Claude = take-selection. Implemented in later milestones; structure here so the
 * Settings keys + flow are ready.
 */
var VEProviders = (function () {
  // POST audio to ElevenLabs Scribe -> word-level transcript. (v0.2)
  async function scribe(wavBuffer, key, languageCode) {
    if (!key) throw new Error("ElevenLabs key not set (Settings)");
    var form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append("language_code", languageCode || "tha");
    form.append("timestamps_granularity", "word");
    form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
    var res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": key }, body: form
    });
    if (!res.ok) throw new Error("Scribe " + res.status + ": " + (await res.text()).slice(0, 200));
    return res.json();
  }

  // Claude take-selection over a transcript. (v0.3)
  async function takeSelect(transcript, key, targetSecs) {
    if (!key) throw new Error("Anthropic key not set (Settings)");
    throw new Error("take-select: implemented in v0.3");
  }

  return { scribe: scribe, takeSelect: takeSelect };
})();
