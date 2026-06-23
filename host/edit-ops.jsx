/*
 * V-Edit host — destructive timeline ops (Auto-Cut Silence).
 * Ported from video-agent/apply_silence_cuts.py (QE razor + ripple-delete).
 *
 * RULES (skill editing-thai-product-videos):
 *  - frame-snap every cut to the sequence fps (no 1-frame slivers)
 *  - operate on the ACTIVE sequence's V1+A1 only
 *  - process ranges back-to-front so earlier positions don't shift
 */

// timecode HH:MM:SS:FF at the sequence fps (QE razor wants a TC string)
function ve_secToTC(sec, fps) {
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    var f = Math.round(sec * fps);
    var h = Math.floor(f / (fps * 3600));
    var m = Math.floor((f % (fps * 3600)) / (fps * 60));
    var s = Math.floor((f % (fps * 60)) / fps);
    var fr = Math.floor(f % fps);
    return pad(h) + ":" + pad(m) + ":" + pad(s) + ":" + pad(fr);
}

// Ripple-delete one timeline range [tlStart,tlEnd] on V1+A1. Returns clips removed.
function ve_rippleCutOne(tlStart, tlEnd, fps) {
    try { app.enableQE(); } catch (e) {}
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) return -1;
    var sTC = ve_secToTC(tlStart, fps);
    var eTC = ve_secToTC(tlEnd, fps);
    var vTrack = qeSeq.getVideoTrackAt(0);
    var aTrack = qeSeq.getAudioTrackAt(0);
    try { vTrack.razor(sTC); vTrack.razor(eTC); } catch (e1) { return -2; }
    try { aTrack.razor(sTC); aTrack.razor(eTC); } catch (e2) { return -3; }
    var seq = app.project.activeSequence;
    var eps = 1.0 / fps / 2.0;
    var removed = 0;
    var tracks = [seq.videoTracks[0], seq.audioTracks[0]];
    for (var ti = 0; ti < tracks.length; ti++) {
        var trk = tracks[ti];
        for (var i = trk.clips.numItems - 1; i >= 0; i--) {
            var c = trk.clips[i];
            if (c.start.seconds >= tlStart - eps && c.end.seconds <= tlEnd + eps) {
                c.remove(true, true);   // ripple-delete, shift left
                removed += 1;
            }
        }
    }
    return removed;
}

/*
 * rangesStr = "a1:b1,a2:b2,..." timeline seconds (silence to remove).
 * Frame-snaps each range, sorts back-to-front, ripple-deletes.
 * Returns "ok|cuts=N|removed=M" or "ERR:...".
 */
function ve_autoCutSilence(rangesStr) {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var fps = ve_seqFps();
    if (!fps) return "ERR:no_fps";
    if (!rangesStr) return "ERR:no_ranges";

    var raw = rangesStr.split(",");
    var ranges = [];
    for (var i = 0; i < raw.length; i++) {
        var p = raw[i].split(":");
        if (p.length !== 2) continue;
        var a = ve_snap(parseFloat(p[0]), fps);
        var b = ve_snap(parseFloat(p[1]), fps);
        if (b - a >= 1.0 / fps) ranges.push([a, b]);
    }
    ranges.sort(function (x, y) { return x[0] - y[0]; });

    var cuts = 0, removed = 0;
    for (var j = ranges.length - 1; j >= 0; j--) {   // back-to-front
        var r = ve_rippleCutOne(ranges[j][0], ranges[j][1], fps);
        if (r >= 0) { cuts += 1; removed += r; }
    }
    return "ok|cuts=" + cuts + "|removed=" + removed;
}
