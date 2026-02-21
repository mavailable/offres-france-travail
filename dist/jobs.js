"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ftUpdateTravailleurSocial_24h = ftUpdateTravailleurSocial_24h;
const config_1 = require("./config");
const secrets_1 = require("./secrets");
const ftApi_1 = require("./ftApi");
const sheet_1 = require("./sheet");
const exclusions_1 = require("./exclusions");
function firstLine(text) {
    const s = (text || "").replace(/\r\n/g, "\n");
    const line = s.split("\n")[0] || "";
    return line.trim();
}
function toDate(iso) {
    // ISO string => Date. If invalid, fallback to now.
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return new Date();
    return d;
}
function ftUpdateTravailleurSocial_24h() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const { offres } = (0, sheet_1.ensureSheets)(ss);
    // Detect if we have UI (menu/manual run) vs time-based trigger
    const allowUi = Boolean(SpreadsheetApp.getUi);
    const secrets = (0, secrets_1.ensureSecrets)(allowUi);
    const existingIds = (0, sheet_1.loadExistingOfferIds)(offres);
    const exclusions = (0, exclusions_1.loadExclusions)(ss);
    const t0 = Date.now();
    const fetched = (0, ftApi_1.searchOffersPaged)(secrets, {
        motsCles: config_1.CONFIG.SEARCH_KEYWORDS,
        publieeDepuis: config_1.CONFIG.PUBLIEE_DEPUIS_DAYS,
    });
    let dedupSkipped = 0;
    let excludedSkipped = 0;
    const toInsert = [];
    for (const o of fetched) {
        if (existingIds.has(o.id)) {
            dedupSkipped++;
            continue;
        }
        const candidate = {
            intitule: o.intitule || "",
            entrepriseNom: o.entrepriseNom || "",
        };
        if ((0, exclusions_1.isExcluded)(candidate, exclusions)) {
            excludedSkipped++;
            continue;
        }
        const description = o.description || "";
        const resume = firstLine(description);
        toInsert.push({
            dateCreation: toDate(o.dateCreation),
            intituleText: o.intitule || "(sans intitulé)",
            intituleUrl: (0, ftApi_1.getOfferPublicUrl)(o.id),
            resume,
            resumeNote: config_1.CONFIG.RESUME_NOTE_PREFIX + description,
            entrepriseNom: o.entrepriseNom || "",
            codePostal: o.codePostal || "",
            typeContratLibelle: o.typeContratLibelle || "",
            dureeTravailLibelle: o.dureeTravailLibelle || "",
            offreId: o.id,
        });
        existingIds.add(o.id);
    }
    (0, sheet_1.appendOffersBatch)(offres, toInsert);
    const ms = Date.now() - t0;
    console.log(`${config_1.CONFIG.LOG_PREFIX} fetched=${fetched.length} dedupSkipped=${dedupSkipped} excludedSkipped=${excludedSkipped} added=${toInsert.length} in ${ms}ms`);
}
