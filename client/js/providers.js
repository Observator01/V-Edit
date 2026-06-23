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

  // Claude take-selection. (v0.3)
  // segments = [{start,end,text}] (line-level, timeline time). opts = {model,targetSecs,profile}.
  // Returns the tool input {keep:[{from_index,to_index,reason}], dropped_count} — index ranges
  // into `segments` (more robust than echoing float times). The caller maps indices -> ranges.
  async function takeSelect(segments, key, opts) {
    if (!key) throw new Error("Anthropic key not set (Settings)");
    opts = opts || {};
    var model = opts.model || "claude-sonnet-4-6";
    var targetSecs = opts.targetSecs || 90;
    var profile = opts.profile;

    var listing = segments.map(function (s, i) {
      return "[" + i + "] " + s.start.toFixed(2) + "–" + s.end.toFixed(2) + "s : " + s.text;
    }).join("\n");

    var styleNote = "";
    if (profile) {
      styleNote = "\n\nEditor style profile (learned from their finished edits — match it):\n"
        + "- typical finished length ≈ " + Math.round(profile.targetSecs || targetSecs) + "s\n"
        + (profile.segMedianDur ? "- typical clean segment ≈ " + profile.segMedianDur.toFixed(1) + "s\n" : "")
        + (profile.pauseMedian ? "- the editor cuts pauses/retakes ≈ " + profile.pauseMedian.toFixed(2) + "s long\n" : "");
    }

    var system = "You are a Thai video editor's assistant. From a raw talking-head recording "
      + "transcript, you select the best speech takes and drop retakes, false starts, stumbles, "
      + "filler, and bloopers — keep only the cleanest version of each line. Preserve narrative "
      + "structure: hook → content/specs → CTA. Curate the kept segments to about " + targetSecs
      + " seconds total. Keep Thai sentence-final particles intact (มะ/คะ/ครับ/นะ/มั้ย). "
      + "Return ONLY via the select_takes tool, as index ranges into the numbered segments.";

    var userMsg = "Raw transcript segments — [index] start–end : text\n\n" + listing
      + styleNote + "\n\nTarget length: ≈ " + targetSecs + "s. Select the kept segments.";

    var tool = {
      name: "select_takes",
      description: "Return the kept segments for the clean cut, in final order, as inclusive index ranges.",
      input_schema: {
        type: "object",
        properties: {
          keep: {
            type: "array",
            description: "Segments to KEEP, in final play order.",
            items: {
              type: "object",
              properties: {
                from_index: { type: "integer", description: "first kept segment index (inclusive)" },
                to_index: { type: "integer", description: "last kept segment index (inclusive)" },
                reason: { type: "string", description: "short reason this take was kept" }
              },
              required: ["from_index", "to_index"]
            }
          },
          dropped_count: { type: "integer", description: "how many segments were dropped" }
        },
        required: ["keep"]
      }
    };

    // Scale output budget with input size — each kept range carries a short Thai `reason`,
    // so a long recording with many retakes can exceed a fixed 4096 and truncate the tool call.
    var maxTokens = Math.max(4096, Math.min(16000, 1024 + segments.length * 80));

    var body = {
      model: model,
      max_tokens: maxTokens,
      system: system,
      tools: [tool],
      tool_choice: { type: "tool", name: "select_takes" },
      messages: [{ role: "user", content: userMsg }]
    };

    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // CEF enforces browser CORS; this is Anthropic's documented client-side opt-in.
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("Claude " + res.status + ": " + (await res.text()).slice(0, 300));
    var data = await res.json();
    // HTTP 200 can still mean an unusable response — never read a truncated/refused tool call.
    if (data.stop_reason === "max_tokens")
      throw new Error("Claude truncated the take selection (max_tokens). Shorten the recording or raise the model output budget.");
    if (data.stop_reason === "refusal")
      throw new Error("Claude declined to process this transcript (refusal).");
    var blocks = (data.content || []).filter(function (b) { return b.type === "tool_use"; });
    if (!blocks.length || !blocks[0].input) throw new Error("Claude returned no take selection");
    return blocks[0].input;
  }

  return { scribe: scribe, takeSelect: takeSelect };
})();
