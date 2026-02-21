"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.parseRule = parseRule;
exports.loadExclusions = loadExclusions;
exports.matchesAnyRule = matchesAnyRule;
exports.isExcluded = isExcluded;
const config_1 = require("./config");
function normalizeText(input) {
    // trim, lowercase, remove accents, normalize spaces
    const s = (input || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove diacritics
        .replace(/\s+/g, " ");
    return s;
}
/**
 * Supports regex in the form /pattern/flags
 * Otherwise uses a normalized "contains" match.
 */
function parseRule(raw) {
    const r = (raw || "").trim();
    if (!r)
        return null;
    if (r.startsWith("/") && r.lastIndexOf("/") > 0) {
        const lastSlash = r.lastIndexOf("/");
        const pattern = r.slice(1, lastSlash);
        const flags = r.slice(lastSlash + 1);
        try {
            const regex = new RegExp(pattern, flags);
            return { raw: r, isRegex: true, regex };
        }
        catch (e) {
            // Fall back to contains (treat as literal) if regex invalid
            return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
        }
    }
    return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
}
function loadExclusions(ss) {
    var _a, _b;
    const sheet = ss.getSheetByName(config_1.CONFIG.SHEET_EXCLUSIONS);
    if (!sheet) {
        // Should have been ensured by sheet.ts, but keep robust.
        return { intituleRules: [], entrepriseRules: [] };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2)
        return { intituleRules: [], entrepriseRules: [] };
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const intituleRules = [];
    const entrepriseRules = [];
    for (const row of values) {
        const a = String((_a = row[0]) !== null && _a !== void 0 ? _a : "").trim();
        const b = String((_b = row[1]) !== null && _b !== void 0 ? _b : "").trim();
        const ra = parseRule(a);
        const rb = parseRule(b);
        if (ra)
            intituleRules.push(ra);
        if (rb)
            entrepriseRules.push(rb);
    }
    return { intituleRules, entrepriseRules };
}
function matchesAnyRule(text, rules) {
    if (!rules.length)
        return false;
    const normalized = normalizeText(text);
    for (const rule of rules) {
        if (rule.isRegex && rule.regex) {
            if (rule.regex.test(text) || rule.regex.test(normalized))
                return true;
        }
        else if (rule.normalizedNeedle) {
            if (normalized.includes(rule.normalizedNeedle))
                return true;
        }
    }
    return false;
}
function isExcluded(offer, exclusions) {
    const title = offer.intitule || "";
    const company = offer.entrepriseNom || "";
    if (matchesAnyRule(title, exclusions.intituleRules))
        return true;
    if (matchesAnyRule(company, exclusions.entrepriseRules))
        return true;
    return false;
}
