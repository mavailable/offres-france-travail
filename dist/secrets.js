"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecrets = getSecrets;
exports.setSecrets = setSecrets;
exports.promptAndStoreSecrets = promptAndStoreSecrets;
exports.ensureSecrets = ensureSecrets;
const config_1 = require("./config");
function getSecrets() {
    const props = PropertiesService.getScriptProperties();
    const clientId = (props.getProperty(config_1.CONFIG.SECRETS.CLIENT_ID) || "").trim();
    const clientSecret = (props.getProperty(config_1.CONFIG.SECRETS.CLIENT_SECRET) || "").trim();
    if (!clientId || !clientSecret)
        return null;
    return { clientId, clientSecret };
}
function setSecrets(secrets) {
    const props = PropertiesService.getScriptProperties();
    props.setProperties({
        [config_1.CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
        [config_1.CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim(),
    }, true);
}
/**
 * Show a UI prompt to collect secrets and store them in Script Properties.
 * If user cancels, throws.
 */
function promptAndStoreSecrets() {
    const ui = SpreadsheetApp.getUi();
    const r1 = ui.prompt("Configuration France Travail", "Saisir FT_CLIENT_ID (client_id):", ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) {
        throw new Error("Configuration annulée (FT_CLIENT_ID manquant).");
    }
    const clientId = (r1.getResponseText() || "").trim();
    if (!clientId)
        throw new Error("FT_CLIENT_ID est vide.");
    const r2 = ui.prompt("Configuration France Travail", "Saisir FT_CLIENT_SECRET (client_secret):", ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) {
        throw new Error("Configuration annulée (FT_CLIENT_SECRET manquant).");
    }
    const clientSecret = (r2.getResponseText() || "").trim();
    if (!clientSecret)
        throw new Error("FT_CLIENT_SECRET est vide.");
    const secrets = { clientId, clientSecret };
    setSecrets(secrets);
    return secrets;
}
/**
 * Ensure secrets exist. If missing:
 * - if allowUi=true, prompts the user and stores them.
 * - else throws a clear error.
 */
function ensureSecrets(allowUi) {
    const existing = getSecrets();
    if (existing)
        return existing;
    if (!allowUi) {
        throw new Error("Secrets France Travail manquants. Ouvrez le Google Sheet puis utilisez le menu France Travail > Configurer les secrets.");
    }
    return promptAndStoreSecrets();
}
