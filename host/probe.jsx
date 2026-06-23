/*
 * V-Edit host — probe the active sequence (read-only).
 * Ported from video-agent/probe_clip_inout.py. Returns plain strings; the panel parses.
 *
 * RULE: always re-probe before any mutation — the user switches projects/sequences
 * constantly (see skill editing-thai-product-videos / premiere-pymiere-rules §3).
 */

// Returns: "name|fps|v1=N|a1=M" + "\n" + one record per V1 clip:
//   idx;tl_start;tl_end;src_in;src_out;mediaPath
function ve_probeSequence() {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var fps = ve_seqFps();
    var v1 = seq.videoTracks[0];
    var a1 = seq.audioTracks[0];
    var head = seq.name + "|" + fps.toFixed(3)
        + "|v1=" + (v1 ? v1.clips.numItems : 0)
        + "|a1=" + (a1 ? a1.clips.numItems : 0);
    var lines = [head];
    if (v1) {
        for (var i = 0; i < v1.clips.numItems; i++) {
            var c = v1.clips[i];
            var mp = "";
            try { mp = c.projectItem.getMediaPath(); } catch (e) {}
            lines.push(
                i + ";" + c.start.seconds.toFixed(3) + ";" + c.end.seconds.toFixed(3)
                + ";" + c.inPoint.seconds.toFixed(3) + ";" + c.outPoint.seconds.toFixed(3)
                + ";" + mp
            );
        }
    }
    return lines.join("\n");
}

// Snapshot of the LOCKED cut (V1 + A1) for additive-safety checks.
// Returns "v1n;a1n;v1end" — compare before/after a mutation; must be identical.
function ve_snapshotLockedCut() {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var v1 = seq.videoTracks[0], a1 = seq.audioTracks[0];
    var v1end = v1 && v1.clips.numItems ? v1.clips[v1.clips.numItems - 1].end.seconds : 0;
    return (v1 ? v1.clips.numItems : 0) + ";" + (a1 ? a1.clips.numItems : 0) + ";" + v1end.toFixed(3);
}
