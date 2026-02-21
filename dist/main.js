"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ftUpdateTravailleurSocial_24h = void 0;
exports.onOpen = onOpen;
exports.buildMenu = buildMenu;
exports.ftConfigureSecrets = ftConfigureSecrets;
exports.ftOpenExclusions = ftOpenExclusions;
exports.ftHelp = ftHelp;
const config_1 = require("./config");
const secrets_1 = require("./secrets");
const jobs_1 = require("./jobs");
Object.defineProperty(exports, "ftUpdateTravailleurSocial_24h", { enumerable: true, get: function () { return jobs_1.ftUpdateTravailleurSocial_24h; } });
const sheet_1 = require("./sheet");
/**
 * GAS entrypoints must be global functions.
 * We re-export wrappers so clasp sees them as top-level.
 */
function onOpen() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    (0, sheet_1.ensureSheets)(ss);
    // If secrets missing, prompt user right away (as requested)
    if (!(0, secrets_1.getSecrets)()) {
        try {
            (0, secrets_1.promptAndStoreSecrets)();
        }
        catch (e) {
            // User cancelled; still show menu so they can configure later.
            console.log(`${config_1.CONFIG.LOG_PREFIX} secrets not configured on open: ${String(e)}`);
        }
    }
    buildMenu();
}
function buildMenu() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu("France Travail")
        .addItem("Mettre à jour (24h)", "ftUpdateTravailleurSocial_24h")
        .addSeparator()
        .addItem("Configurer les secrets", "ftConfigureSecrets")
        .addItem("Ouvrir l’onglet Exclusions", "ftOpenExclusions")
        .addSeparator()
        .addItem("Aide / README", "ftHelp")
        .addToUi();
}
function ftConfigureSecrets() {
    (0, secrets_1.promptAndStoreSecrets)();
    SpreadsheetApp.getUi().alert("Secrets enregistrés dans Script Properties.");
}
function ftOpenExclusions() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    (0, sheet_1.ensureSheets)(ss);
    (0, sheet_1.activateSheet)(ss, config_1.CONFIG.SHEET_EXCLUSIONS);
}
function ftHelp() {
    const msg = "Outil France Travail (Offres v2)\n\n" +
        "• Menu > France Travail > Mettre à jour (24h) : importe les offres publiées depuis 1 jour pour la recherche \"travailleur social\".\n" +
        "• Déduplication : basée sur l'ID offre stocké en colonne masquée (offre_id).\n" +
        "• Exclusions : onglet Exclusions (col A = règles intitulé, col B = règles entreprise).\n" +
        "  - Texte simple = match 'contains' après normalisation (minuscule, sans accents).\n" +
        "  - Regex = /pattern/flags.\n\n" +
        "Secrets\n" +
        "• FT_CLIENT_ID / FT_CLIENT_SECRET sont stockés dans Script Properties.\n" +
        "• Le token OAuth est mis en cache ~50 minutes.\n";
    SpreadsheetApp.getUi().alert(msg);
}
