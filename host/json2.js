/*
 * json2.js — JSON.parse / JSON.stringify for ExtendScript (ES3, no native JSON).
 * Public domain, after Douglas Crockford (https://github.com/douglascrockford/JSON-js).
 * Loaded FIRST by host/index.jsx so MOGRT Source Text (a JSON value) can be
 * read/modified/written. Regexes are ASCII-only on purpose: JSON permits raw (un-escaped)
 * Unicode in string values, so Thai text passes through untouched; we only escape the
 * mandatory characters (backslash, double-quote, control chars) and neutralize the two
 * line/paragraph separators that would break eval() during parse.
 */
if (typeof JSON !== "object") { JSON = {}; }

(function () {
    var escapable = /[\\\"\x00-\x1f]/g,
        gap,
        indent,
        meta = {
            "\b": "\\b",
            "\t": "\\t",
            "\n": "\\n",
            "\f": "\\f",
            "\r": "\\r",
            "\"": "\\\"",
            "\\": "\\\\"
        };

    function quote(string) {
        escapable.lastIndex = 0;
        return escapable.test(string)
            ? "\"" + string.replace(escapable, function (a) {
                var c = meta[a];
                return typeof c === "string"
                    ? c
                    : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
            }) + "\""
            : "\"" + string + "\"";
    }

    function str(key, holder) {
        var i, k, v, length, mind = gap, partial, value = holder[key];

        switch (typeof value) {
        case "string":
            return quote(value);
        case "number":
            return isFinite(value) ? String(value) : "null";
        case "boolean":
        case "null":
            return String(value);
        case "object":
            if (!value) { return "null"; }
            gap += indent;
            partial = [];
            if (Object.prototype.toString.apply(value) === "[object Array]") {
                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || "null";
                }
                v = partial.length === 0
                    ? "[]"
                    : gap
                        ? "[\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "]"
                        : "[" + partial.join(",") + "]";
                gap = mind;
                return v;
            }
            for (k in value) {
                if (Object.prototype.hasOwnProperty.call(value, k)) {
                    v = str(k, value);
                    if (v) {
                        partial.push(quote(k) + (gap ? ": " : ":") + v);
                    }
                }
            }
            v = partial.length === 0
                ? "{}"
                : gap
                    ? "{\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "}"
                    : "{" + partial.join(",") + "}";
            gap = mind;
            return v;
        }
    }

    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value, replacer, space) {
            var i;
            gap = "";
            indent = "";
            if (typeof space === "number") {
                for (i = 0; i < space; i += 1) { indent += " "; }
            } else if (typeof space === "string") {
                indent = space;
            }
            return str("", { "": value });
        };
    }

    if (typeof JSON.parse !== "function") {
        var cx = /[\u2028\u2029]/g;
        JSON.parse = function (text, reviver) {
            var j;

            function walk(holder, key) {
                var k, v, value = holder[key];
                if (value && typeof value === "object") {
                    for (k in value) {
                        if (Object.prototype.hasOwnProperty.call(value, k)) {
                            v = walk(value, k);
                            if (v !== undefined) {
                                value[k] = v;
                            } else {
                                delete value[k];
                            }
                        }
                    }
                }
                return reviver.call(holder, key, value);
            }

            text = String(text);
            cx.lastIndex = 0;
            if (cx.test(text)) {
                text = text.replace(cx, function (a) {
                    return "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
                });
            }

            if (/^[\],:{}\s]*$/.test(
                    text
                        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                        .replace(/(?:^|:|,)(?:\s*\[)+/g, ""))) {

                j = eval("(" + text + ")");

                return typeof reviver === "function"
                    ? walk({ "": j }, "")
                    : j;
            }

            throw new SyntaxError("JSON.parse");
        };
    }
}());
