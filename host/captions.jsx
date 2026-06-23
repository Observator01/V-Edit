/*
 * V-Edit host — MOGRT captions (ADDITIVE on V2/V3). Ported from
 * video-agent/tank500_captions_mogrt.py.
 *
 * RULES: never touch V1/A1. Place on the chosen video track (index >= 1) only.
 * importMGT is additive (does not ripple other tracks — verified). Text is set
 * via the Text component's Source Text setValue (getMGTComponent()=null in v26).
 * Caller frame-snaps tlStart/tlEnd before calling.
 */

var VE_TICKS = 254016000000;  // ticks per second

// Remove all clips on a caption track (idempotent re-generate). REFUSES track 0.
function ve_clearCaptionTrack(trackIdx) {
    if (trackIdx < 1) return "ERR:refuse_track0";
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    if (trackIdx >= seq.videoTracks.numTracks) return "ok|removed=0";
    var trk = seq.videoTracks[trackIdx];
    var n = 0;
    for (var i = trk.clips.numItems - 1; i >= 0; i--) { trk.clips[i].remove(false, false); n++; }
    return "ok|removed=" + n;
}

// Place one MOGRT caption on videoTrack[trackIdx] at [tlStart,tlEnd], set its text.
// Returns "ok|start-end" or "ERR:...".
function ve_placeCaption(mogrtPath, trackIdx, tlStart, tlEnd, text) {
    if (trackIdx < 1) return "ERR:refuse_track0";
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var t = String(Math.round(tlStart * VE_TICKS));
    var trk = seq.videoTracks[trackIdx];
    var before = trk.clips.numItems;
    try { seq.importMGT(mogrtPath, t, trackIdx, -1); }
    catch (e) { return "ERR:import:" + e; }

    // find the newly-added clip (nearest start to tlStart)
    var clip = null, best = 1e9;
    for (var i = 0; i < trk.clips.numItems; i++) {
        var d = Math.abs(trk.clips[i].start.seconds - tlStart);
        if (d < best) { best = d; clip = trk.clips[i]; }
    }
    if (!clip || trk.clips.numItems <= before) return "ERR:noclip_after_import";

    // duration
    try { var T = new Time(); T.seconds = tlEnd; clip.end = T; } catch (e2) {}

    // text: Text component Source Text setValue (plain string works)
    try {
        for (var ci = 0; ci < clip.components.numItems; ci++) {
            if (clip.components[ci].displayName === "Text") {
                clip.components[ci].properties[0].setValue(text, true);
                break;
            }
        }
    } catch (e3) { return "ERR:settext:" + e3; }

    return "ok|" + clip.start.seconds.toFixed(2) + "-" + clip.end.seconds.toFixed(2);
}
