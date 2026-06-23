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
// textLayer (optional) = the template's text component/layer name, when auto-detect can't
// find it (a MOGRT component's displayName is the creator's layer name — often not "Text").
// Returns "ok|start-end", or "ok|notext|start-end|layers=a/b/c" when the text couldn't be set
// (caption placed but no editable text component matched — names listed so the user can pick one),
// or "ERR:...".
function ve_placeCaption(mogrtPath, trackIdx, tlStart, tlEnd, text, textLayer) {
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

    // text: set the MOGRT Source Text. The component displayName = the creator's layer name
    // (varies per template, may be Thai), and property displayName is LOCALIZED — so don't rely
    // on a single hardcoded name. Try, in order: explicit hint → a "Source Text" property →
    // legacy "Text" component. (getMGTComponent() returns null in v26, so iterate components.)
    var comps = clip.components;
    var names = [];
    for (var ni = 0; ni < comps.numItems; ni++) { names.push(comps[ni].displayName); }
    var setOk = false;
    try {
        // pass 1 — explicit hint: component whose displayName matches textLayer
        if (textLayer) {
            for (var i1 = 0; i1 < comps.numItems && !setOk; i1++) {
                if (comps[i1].displayName === textLayer && comps[i1].properties.numItems) {
                    comps[i1].properties[0].setValue(text, 1); setOk = true;
                }
            }
        }
        // pass 2 — a property literally named "Source Text" (English-locale MOGRT)
        for (var i2 = 0; i2 < comps.numItems && !setOk; i2++) {
            var props = comps[i2].properties;
            for (var j2 = 0; j2 < props.numItems && !setOk; j2++) {
                if (props[j2].displayName === "Source Text") { props[j2].setValue(text, 1); setOk = true; }
            }
        }
        // pass 3 — legacy: component named "Text", its first property
        for (var i3 = 0; i3 < comps.numItems && !setOk; i3++) {
            if (comps[i3].displayName === "Text" && comps[i3].properties.numItems) {
                comps[i3].properties[0].setValue(text, 1); setOk = true;
            }
        }
    } catch (e3) { return "ERR:settext:" + e3; }

    var span = clip.start.seconds.toFixed(2) + "-" + clip.end.seconds.toFixed(2);
    if (!setOk) return "ok|notext|" + span + "|layers=" + names.join("/");
    return "ok|" + span;
}
