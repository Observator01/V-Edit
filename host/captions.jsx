/*
 * V-Edit host — MOGRT captions (ADDITIVE on V2/V3). Ported from
 * video-agent/tank500_captions_mogrt.py.
 *
 * RULES: never touch V1/A1. Place on the chosen video track (index >= 1) only.
 * importMGT is additive (does not ripple other tracks — verified). The MOGRT Source
 * Text value is JSON (textEditValue/fontTextRunLength), not a plain string — see
 * ve_placeCaption. Needs JSON (host/json2.js, included first). Caller frame-snaps tlStart/tlEnd.
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
// A MOGRT Source Text value is a JSON object (NOT a plain string) — setValue("string")
// just blanks the text. The correct write is: getValue() -> JSON.parse -> set textEditValue
// + fontTextRunLength -> setValue(JSON.stringify, 0). We auto-detect the text param by that
// JSON shape (so it works regardless of the control's name); textLayer (optional) biases which
// property is tried first. A plain-string fallback covers simple/legacy params.
// Returns "ok|start-end", or "ok|notext|start-end|layers=a/b/c" (placed but no text param
// matched — component[prop/prop] map listed), or "ERR:...".
function ve_placeCaption(mogrtPath, trackIdx, tlStart, tlEnd, text, textLayer) {
    if (trackIdx < 1) return "ERR:refuse_track0";
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    var t = String(Math.round(tlStart * VE_TICKS));
    var trk = seq.videoTracks[trackIdx];
    var before = trk.clips.numItems;

    // importMGT returns the placed TrackItem (per ppro docs); fall back to nearest-start search.
    var clip = null;
    try { clip = seq.importMGT(mogrtPath, t, trackIdx, -1); }
    catch (e) { return "ERR:import:" + e; }
    if (!clip || !clip.components) {
        var best = 1e9;
        for (var i = 0; i < trk.clips.numItems; i++) {
            var d = Math.abs(trk.clips[i].start.seconds - tlStart);
            if (d < best) { best = d; clip = trk.clips[i]; }
        }
    }
    if (!clip || trk.clips.numItems <= before) return "ERR:noclip_after_import";

    // duration
    try { var T = new Time(); T.seconds = tlEnd; clip.end = T; } catch (e2) {}

    // ---- set the caption text ----
    var comps = clip.components;
    var map = [];   // diagnostic: compName[prop0/prop1/...] for every component
    for (var ni = 0; ni < comps.numItems; ni++) {
        var pn = [];
        for (var pj = 0; pj < comps[ni].properties.numItems; pj++) { pn.push(comps[ni].properties[pj].displayName); }
        map.push(comps[ni].displayName + "[" + pn.join("/") + "]");
    }

    // Proper MOGRT Source-Text write: the value is JSON {textEditValue, fontTextRunLength, ...}.
    // Returns true if this property was a JSON text param and we set it.
    function trySetJSON(prop) {
        try {
            var obj = JSON.parse(prop.getValue());
            if (obj && typeof obj.textEditValue !== "undefined") {
                obj.textEditValue = text;
                obj.fontTextRunLength = [text.length];   // one font run over the whole string
                prop.setValue(JSON.stringify(obj), 0);
                return true;
            }
        } catch (e) {}
        return false;
    }

    var setOk = false;
    try {
        // 1) hinted property/component first (when several text params exist)
        if (textLayer) {
            for (var i1 = 0; i1 < comps.numItems && !setOk; i1++) {
                if (comps[i1].displayName === textLayer && comps[i1].properties.numItems) {
                    if (trySetJSON(comps[i1].properties[0])) setOk = true;
                }
                var p1 = comps[i1].properties;
                for (var k1 = 0; k1 < p1.numItems && !setOk; k1++) {
                    if (p1[k1].displayName === textLayer && trySetJSON(p1[k1])) setOk = true;
                }
            }
        }
        // 2) auto-detect the Source-Text param by its JSON shape (textEditValue)
        for (var i2 = 0; i2 < comps.numItems && !setOk; i2++) {
            var p2 = comps[i2].properties;
            for (var k2 = 0; k2 < p2.numItems && !setOk; k2++) {
                if (trySetJSON(p2[k2])) setOk = true;
            }
        }
        // 3) fallback for simple/legacy params whose value is a plain string (not JSON)
        if (!setOk && textLayer) {
            for (var i3 = 0; i3 < comps.numItems && !setOk; i3++) {
                if (comps[i3].displayName === textLayer && comps[i3].properties.numItems) {
                    comps[i3].properties[0].setValue(text, 0); setOk = true;
                }
                var p3 = comps[i3].properties;
                for (var k3 = 0; k3 < p3.numItems && !setOk; k3++) {
                    if (p3[k3].displayName === textLayer) { p3[k3].setValue(text, 0); setOk = true; }
                }
            }
        }
        if (!setOk) {
            for (var i4 = 0; i4 < comps.numItems && !setOk; i4++) {
                var p4 = comps[i4].properties;
                for (var k4 = 0; k4 < p4.numItems && !setOk; k4++) {
                    if (p4[k4].displayName === "Source Text") { p4[k4].setValue(text, 0); setOk = true; }
                }
            }
        }
        if (!setOk) {
            for (var i5 = 0; i5 < comps.numItems && !setOk; i5++) {
                if (comps[i5].displayName === "Text" && comps[i5].properties.numItems) {
                    comps[i5].properties[0].setValue(text, 0); setOk = true;
                }
            }
        }
    } catch (e3) { return "ERR:settext:" + e3; }

    var span = clip.start.seconds.toFixed(2) + "-" + clip.end.seconds.toFixed(2);
    if (!setOk) return "ok|notext|" + span + "|layers=" + map.join(" ");
    return "ok|" + span;
}

// Diagnostic dump of the FIRST clip already on videoTracks[trackIdx] — reveals exactly why text
// won't set: whether JSON loaded, whether getMGTComponent/getValue work in this build, and what
// each text param's value actually is. Run after a Generate (clips already placed). Read-only.
function ve_diagnoseCaption(trackIdx) {
    var out = [];
    out.push("JSON=" + (typeof JSON)
        + " parse=" + (typeof (typeof JSON === "object" ? JSON.parse : 0))
        + " stringify=" + (typeof (typeof JSON === "object" ? JSON.stringify : 0)));
    var seq = app.project.activeSequence;
    if (!seq) return "ERR:no_active_sequence";
    if (!trackIdx || trackIdx >= seq.videoTracks.numTracks) return "ERR:no_such_track " + trackIdx;
    var trk = seq.videoTracks[trackIdx];
    if (!trk.clips.numItems) return "ERR:no_clips_on_track (Generate first)";
    var clip = trk.clips[0];
    out.push("clip=\"" + clip.name + "\" comps=" + clip.components.numItems);

    // getMGTComponent (docs' canonical path; reportedly null in v26 — confirm here)
    var mgtInfo = "n/a";
    try {
        var mgt = clip.getMGTComponent ? clip.getMGTComponent() : null;
        if (mgt) {
            var mp = [];
            for (var g = 0; g < mgt.properties.numItems; g++) mp.push(mgt.properties[g].displayName);
            mgtInfo = "props=" + mgt.properties.numItems + " [" + mp.join("/") + "]";
        } else { mgtInfo = "null"; }
    } catch (em) { mgtInfo = "ERR:" + em; }
    out.push("getMGTComponent=" + mgtInfo);

    var comps = clip.components;
    for (var ci = 0; ci < comps.numItems; ci++) {
        var comp = comps[ci];
        out.push("[" + ci + "] \"" + comp.displayName + "\" props=" + comp.properties.numItems);
        for (var pj = 0; pj < comp.properties.numItems; pj++) {
            var pr = comp.properties[pj];
            var line = "  [" + pj + "] \"" + pr.displayName + "\" gv=" + (typeof pr.getValue);
            try {
                if (typeof pr.getValue === "function") {
                    var gv = pr.getValue();
                    var gt = typeof gv;
                    line += " gvType=" + gt;
                    if (gt === "string") {
                        var s = gv.length > 220 ? gv.substring(0, 220) + "..." : gv;
                        line += " val=" + s;
                        try {
                            var o = JSON.parse(gv);
                            line += " json=yes tev=" + ((o && typeof o.textEditValue !== "undefined") ? "YES" : "no");
                        } catch (ej) { line += " json=no"; }
                    } else if (gt === "object" && gv) {
                        var so = "";
                        try { so = JSON.stringify(gv); } catch (es) { so = "[stringifyERR]"; }
                        if (so.length > 220) so = so.substring(0, 220) + "...";
                        line += " objVal=" + so + " tev=" + ((typeof gv.textEditValue !== "undefined") ? "YES" : "no");
                    } else {
                        line += " val=" + String(gv);
                    }
                }
            } catch (eg) { line += " GETVAL_ERR:" + eg; }
            out.push(line);
        }
    }
    return out.join("\n");
}
