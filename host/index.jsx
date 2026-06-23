/*
 * V-Edit host (ExtendScript) — entry point.
 * Loaded by CEP (manifest ScriptPath). #includes the operation modules.
 *
 * Convention: functions return PIPE/NEWLINE-delimited strings (NOT JSON) — the
 * ExtendScript JSON object is unreliable across Premiere builds, so the panel
 * parses plain strings. Errors are returned as "ERR:<message>".
 */

//@include "probe.jsx"
//@include "edit-ops.jsx"
//@include "captions.jsx"
#include "probe.jsx"
#include "edit-ops.jsx"
#include "captions.jsx"

// Sequence frame rate from timebase ticks (254016000000 ticks/sec).
function ve_seqFps() {
    var seq = app.project.activeSequence;
    if (!seq) return 0;
    return 254016000000 / Number(seq.timebase);
}

// Snap seconds to the sequence frame grid (avoids 1-frame slivers).
function ve_snap(sec, fps) {
    if (!fps) fps = ve_seqFps();
    if (!fps) return sec;
    return Math.round(sec * fps) / fps;
}

// Health check — used by the panel on load.
function ve_ping() {
    var seq = app.project.activeSequence;
    return "ok|version=" + app.version
        + "|project=" + (app.project ? app.project.name : "none")
        + "|sequence=" + (seq ? seq.name : "none")
        + "|fps=" + ve_seqFps().toFixed(3);
}
