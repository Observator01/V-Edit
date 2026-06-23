/*
 * V-Edit host — build a CLEAN sequence from an AI take-select EDL.
 * Ported from video-agent/build_tank500_clean_seq.py (clone_rename + clear + place),
 * generalized: no hardcoded media/sequence name.
 *
 * RULES (skill editing-thai-product-videos):
 *  - NEVER mutate the raw cut. We build a NEW "<name> - CLEAN" sequence (clone of the
 *    raw, then cleared + re-placed). The raw sequence is never edited.
 *  - frame-snap every in/out + cursor to the sequence fps (no 1-frame slivers).
 *  - insertClip on a freshly-cleared sequence ripples into empty space — safe (proven).
 *
 * planStr = "mediaPath;srcIn;srcOut" records joined by "\n" (source seconds, in order).
 * Returns "ok|placed=N|failed=M|dur=S" or "ERR:...".
 */

// Walk the project root for the projectItem whose media path matches (separator-insensitive).
function ve_findItemByPath(root, mediaPath) {
    function norm(s) { return String(s).replace(/\\/g, "/"); }
    var want = norm(mediaPath);
    function walk(r) {
        for (var k = 0; k < r.children.numItems; k++) {
            var it = r.children[k];
            var mp = "";
            try { mp = it.getMediaPath(); } catch (e) {}
            if (mp && norm(mp) === want) return it;
            if (it.type === 2) { var x = walk(it); if (x) return x; }  // type 2 = bin → recurse
        }
        return null;
    }
    return walk(root);
}

// Remove every clip on every track of a sequence (non-ripple — we are emptying it).
function ve_clearAllClips(seq) {
    var n = 0, t, i;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var v = seq.videoTracks[t];
        for (i = v.clips.numItems - 1; i >= 0; i--) { v.clips[i].remove(false, false); n++; }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        var a = seq.audioTracks[t];
        for (i = a.clips.numItems - 1; i >= 0; i--) { a.clips[i].remove(false, false); n++; }
    }
    return n;
}

function ve_buildCleanSeq(planStr) {
    var proj = app.project;
    var raw = proj.activeSequence;
    if (!raw) return "ERR:no_active_sequence";
    if (!planStr) return "ERR:no_plan";
    var fps = ve_seqFps();
    if (!fps) return "ERR:no_fps";

    var rawName = raw.name;
    var cleanName = rawName + " - CLEAN";

    // Find an existing CLEAN sequence to reuse (activate + clear), else clone the raw.
    var existing = null;
    for (var i = 0; i < proj.sequences.numSequences; i++) {
        if (proj.sequences[i].name === cleanName) { existing = proj.sequences[i]; break; }
    }
    if (existing) {
        proj.activeSequence = existing;
    } else {
        // Snapshot sequence identities BEFORE cloning so we can find the NEW one by diff.
        // clone() returns only a Boolean and does NOT auto-activate; matching the "Copy"
        // suffix is locale-dependent AND collides when rawName itself contains "Copy"
        // (common — editors duplicate a sequence in the UI). A sequenceID diff is safe:
        // it can never select the raw, so the raw cut is never renamed/cleared.
        var beforeIds = {};
        for (var b = 0; b < proj.sequences.numSequences; b++) {
            beforeIds[proj.sequences[b].sequenceID] = true;
        }
        raw.clone();
        var dupe = null;
        for (var j = 0; j < proj.sequences.numSequences; j++) {
            var q = proj.sequences[j];
            if (!beforeIds[q.sequenceID]) { dupe = q; break; }   // the one new sequence
        }
        if (!dupe) return "ERR:clone_failed";
        if (dupe.sequenceID === raw.sequenceID) return "ERR:clone_collision";  // never touch raw
        dupe.name = cleanName;
        proj.activeSequence = dupe;
    }

    var act = proj.activeSequence;
    // Re-read fps from the sequence we are actually writing — a reused (hand-made) CLEAN
    // sequence may have a different timebase than the raw we sampled fps from above.
    fps = ve_seqFps();
    if (!fps) return "ERR:no_fps";
    ve_clearAllClips(act);

    var records = planStr.split("\n");
    var cursor = 0.0, placed = 0, failed = 0;
    for (var r = 0; r < records.length; r++) {
        var rec = records[r];
        if (!rec) continue;
        var p = rec.split(";");
        if (p.length < 3) { failed++; continue; }
        var srcIn = ve_snap(parseFloat(p[1]), fps);
        var srcOut = ve_snap(parseFloat(p[2]), fps);
        var dur = srcOut - srcIn;
        if (!(dur >= 1.0 / fps)) { failed++; continue; }

        var item = ve_findItemByPath(proj.rootItem, p[0]);
        if (!item) { failed++; continue; }
        try {
            item.setInPoint(srcIn, 1); item.setInPoint(srcIn, 2);
            item.setOutPoint(srcOut, 1); item.setOutPoint(srcOut, 2);
        } catch (e) { failed++; continue; }

        var tm = new Time(); tm.seconds = ve_snap(cursor, fps);
        try { act.insertClip(item, tm, 0, 0); } catch (e2) { failed++; continue; }
        placed++;
        cursor = ve_snap(cursor + dur, fps);
    }
    return "ok|placed=" + placed + "|failed=" + failed + "|dur=" + cursor.toFixed(2);
}
