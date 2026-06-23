/*
 * V-Edit host — analyze a FINISHED sequence (read-only) for the Learning analyzer.
 * No .prproj parsing: V-Edit runs inside Premiere, so we read the active sequence
 * directly. The panel (client/js/learning.js) turns this raw dump into a style profile.
 *
 * Returns delimited lines (NOT JSON — ExtendScript JSON is unreliable):
 *   head : "name|fps|durationSec|v1clips"
 *   V1   : "V1;idx;tlStart;tlEnd;srcIn;srcOut;mediaPath"     (one per V1 clip)
 *   VT   : "VT;trackIndex;numItems;coveredSec"               (one per upper video track w/ clips)
 * The client computes segment durations, the pauses the editor cut (gaps between
 * consecutive kept source ranges), caption cadence, and b-roll coverage.
 */
function ve_analyzeFinishedSeq() {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var fps = ve_seqFps();
    var v1 = seq.videoTracks[0];
    var v1n = v1 ? v1.clips.numItems : 0;
    var dur = v1n ? v1.clips[v1n - 1].end.seconds : 0;

    var lines = [seq.name + "|" + fps.toFixed(3) + "|" + dur.toFixed(3) + "|" + v1n];

    if (v1) {
        for (var i = 0; i < v1n; i++) {
            var c = v1.clips[i];
            var mp = "";
            try { mp = c.projectItem.getMediaPath(); } catch (e) {}
            lines.push(
                "V1;" + i
                + ";" + c.start.seconds.toFixed(3)
                + ";" + c.end.seconds.toFixed(3)
                + ";" + c.inPoint.seconds.toFixed(3)
                + ";" + c.outPoint.seconds.toFixed(3)
                + ";" + mp
            );
        }
    }

    // Upper video tracks (V2+) = captions / graphics / b-roll. Report coverage; the
    // client picks the densest track as the caption track and treats the rest as b-roll.
    for (var t = 1; t < seq.videoTracks.numTracks; t++) {
        var vt = seq.videoTracks[t];
        var n = vt.clips.numItems;
        if (!n) continue;
        var cov = 0;
        for (var k = 0; k < n; k++) {
            cov += (vt.clips[k].end.seconds - vt.clips[k].start.seconds);
        }
        lines.push("VT;" + t + ";" + n + ";" + cov.toFixed(3));
    }

    return lines.join("\n");
}
