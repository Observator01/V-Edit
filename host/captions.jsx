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

    // text: set the MOGRT Source Text. The exposed control may be a COMPONENT or a PROPERTY
    // (ComponentParam), and its displayName is the creator's control name (e.g. "TextLayer",
    // not "Text") and is localized — so match the hint against component AND property names,
    // then fall back to a "Source Text" property / legacy "Text" component.
    // (getMGTComponent() returns null in v26, so iterate clip.components.)
    // IMPORTANT: setValue(text, 0) — updateUI MUST be 0. For a canAnimate:false (static EGP-store)
    // text control, updateUI=1 forces an Essential-Graphics panel sync between the generate loop's
    // evalScript calls that re-reads the instance and reverts our text to the template default —
    // the caption then shows for ONE frame and vanishes. updateUI=0 still writes the value (it just
    // doesn't force a panel refresh), so it persists like a manual edit, for static AND animatable templates.
    var comps = clip.components;
    var map = [];   // diagnostic: compName[prop0/prop1/...] for every component
    for (var ni = 0; ni < comps.numItems; ni++) {
        var pn = [];
        for (var pj = 0; pj < comps[ni].properties.numItems; pj++) { pn.push(comps[ni].properties[pj].displayName); }
        map.push(comps[ni].displayName + "[" + pn.join("/") + "]");
    }
    var setOk = false;
    try {
        // pass 1 — explicit hint: a COMPONENT or a PROPERTY whose displayName === textLayer
        if (textLayer) {
            for (var i1 = 0; i1 < comps.numItems && !setOk; i1++) {
                if (comps[i1].displayName === textLayer && comps[i1].properties.numItems) {
                    comps[i1].properties[0].setValue(text, 0); setOk = true;
                }
                var p1 = comps[i1].properties;
                for (var k1 = 0; k1 < p1.numItems && !setOk; k1++) {
                    if (p1[k1].displayName === textLayer) { p1[k1].setValue(text, 0); setOk = true; }
                }
            }
        }
        // pass 2 — a property literally named "Source Text" (English-locale MOGRT)
        for (var i2 = 0; i2 < comps.numItems && !setOk; i2++) {
            var p2 = comps[i2].properties;
            for (var k2 = 0; k2 < p2.numItems && !setOk; k2++) {
                if (p2[k2].displayName === "Source Text") { p2[k2].setValue(text, 0); setOk = true; }
            }
        }
        // pass 3 — legacy: component named "Text", its first property
        for (var i3 = 0; i3 < comps.numItems && !setOk; i3++) {
            if (comps[i3].displayName === "Text" && comps[i3].properties.numItems) {
                comps[i3].properties[0].setValue(text, 0); setOk = true;
            }
        }
    } catch (e3) { return "ERR:settext:" + e3; }

    var span = clip.start.seconds.toFixed(2) + "-" + clip.end.seconds.toFixed(2);
    if (!setOk) return "ok|notext|" + span + "|layers=" + map.join(" ");
    return "ok|" + span;
}
