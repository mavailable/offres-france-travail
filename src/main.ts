import { CONFIG } from "./config";
import { getSecrets, promptAndStoreSecrets } from "./secrets";
import {
  ftUpdateTravailleurSocial_24h,
  ftUpdateTravailleurSocial_7j,
  ftUpdateTravailleurSocial_31j,
  ftUpdateTravailleurSocial_30j,
} from "./jobs";
import { activateSheet, ensureSheets } from "./sheet";

const INIT_PROP_KEY = "FT_INIT_DONE";

function isInitialized(): boolean {
  try {
    return PropertiesService.getScriptProperties().getProperty(INIT_PROP_KEY) === "1";
  } catch (_e) {
    return false;
  }
}

// Ensure a single time-based trigger exists for daily update.
function ensureDailyMidnightTrigger(): void {
  const handler = "ftUpdateTravailleurSocial_24h";

  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(
    (t) =>
      t.getHandlerFunction &&
      t.getHandlerFunction() === handler &&
      t.getEventType &&
      t.getEventType() === ScriptApp.EventType.CLOCK
  );

  if (!exists) {
    // Run daily around midnight (Apps Script may schedule a bit after 00:00).
    ScriptApp.newTrigger(handler).timeBased().atHour(0).everyDays(1).create();
  }
}

function hasDailyMidnightTrigger(): boolean {
  const handler = "ftUpdateTravailleurSocial_24h";
  try {
    const triggers = ScriptApp.getProjectTriggers();
    return triggers.some(
      (t) =>
        t.getHandlerFunction &&
        t.getHandlerFunction() === handler &&
        t.getEventType &&
        t.getEventType() === ScriptApp.EventType.CLOCK
    );
  } catch (_e) {
    return false;
  }
}

function canUseTriggers(): boolean {
  try {
    ScriptApp.getProjectTriggers();
    return true;
  } catch (_e) {
    return false;
  }
}

function canUseProperties(): boolean {
  try {
    PropertiesService.getScriptProperties().getKeys();
    return true;
  } catch (_e) {
    return false;
  }
}

function canUseCache(): boolean {
  try {
    const c = CacheService.getScriptCache();
    c.put("FT_HEALTHCHECK", "1", 10);
    c.remove("FT_HEALTHCHECK");
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Non-blocking health check meant to run from onOpen.
 * It should NOT prompt for OAuth or secrets.
 */
export function ftHealthCheckSilent(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const issues: string[] = [];

  // Basic access to Spreadsheet
  try {
    ss.getId();
  } catch (_e) {
    issues.push("Accès au Spreadsheet: non autorisé.");
  }

  // Vital services
  if (!canUseProperties())
    issues.push("Propriétés du script (Script Properties): non autorisé.");
  if (!canUseCache()) issues.push("CacheService: non autorisé.");

  // Secrets present?
  try {
    if (!getSecrets()) issues.push("Secrets manquants (FT_CLIENT_ID / FT_CLIENT_SECRET)." );
  } catch (_e) {
    issues.push("Lecture des secrets: impossible (droits Script Properties).");
  }

  // Trigger daily
  if (!canUseTriggers()) {
    issues.push("Triggers (déclencheurs): non autorisé.");
  } else if (!hasDailyMidnightTrigger()) {
    issues.push("Déclencheur quotidien (00h) absent. Lancez France Travail » Initialiser.");
  }

  // Report as toast (non-blocking)
  try {
    if (issues.length) {
      ss.toast(
        `Health check: ${issues.length} point(s) à corriger.\n` + issues.slice(0, 3).join("\n"),
        "France Travail",
        20
      );
    }
  } catch (_e) {
    // ignore
  }

  // Also log full details for admin
  if (issues.length) {
    console.warn(`${CONFIG.LOG_PREFIX} Health check issues:\n- ${issues.join("\n- ")}`);
  } else {
    console.log(`${CONFIG.LOG_PREFIX} Health check OK`);
  }
}

/**
 * Interactive health check from menu.
 */
export function ftHealthCheck(): void {
  const ui = SpreadsheetApp.getUi();
  const issues: string[] = [];

  // Permissions / services
  if (!canUseProperties()) issues.push("Propriétés du script: NON");
  if (!canUseCache()) issues.push("CacheService: NON");
  if (!canUseTriggers()) issues.push("Triggers: NON");

  // Secrets
  const secretsOk = (() => {
    try {
      return Boolean(getSecrets());
    } catch (_e) {
      return false;
    }
  })();
  if (!secretsOk) issues.push("Secrets FT_CLIENT_ID / FT_CLIENT_SECRET: manquants ou illisibles");

  // Trigger
  const triggerOk = canUseTriggers() ? hasDailyMidnightTrigger() : false;
  if (!triggerOk) issues.push("Déclencheur quotidien 00h: absent");

  const title = "France Travail » Health check";
  if (!issues.length) {
    ui.alert(
      title,
      "Tout est OK.\n\nSecrets présents, droits valides, déclencheur quotidien en place.",
      ui.ButtonSet.OK
    );
    return;
  }

  const msg =
    "Points à corriger :\n\n- " +
    issues.join("\n- ") +
    "\n\nActions :\n" +
    "» France Travail > Initialiser (crée le déclencheur)\n" +
    "» France Travail > Configurer les secrets";

  ui.alert(title, msg, ui.ButtonSet.OK);
}

/**
 * Explicit initializer to be run by the user once.
 * This is the right place to trigger the OAuth consent screen.
 */
export function ftInit(): void {
  const ui = SpreadsheetApp.getUi();

  // Touch services needing authorization
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);

  // Ensure secrets exist (prompt user if missing)
  if (!getSecrets()) {
    promptAndStoreSecrets();
  }

  ensureDailyMidnightTrigger();

  // Mark initialized
  PropertiesService.getScriptProperties().setProperty(INIT_PROP_KEY, "1");

  ui.alert(
    "France Travail",
    "Initialisation OK.\n\nLe déclencheur quotidien (00h) est en place.",
    ui.ButtonSet.OK
  );
}

/**
 * GAS entrypoints must be global functions.
 * We re-export wrappers so clasp sees them as top-level.
 */

export function onOpen(): void {
  // DEBUG: prove onOpen runs even if UI/menu fails
  try {
    PropertiesService.getScriptProperties().setProperty(
      "FT_DEBUG_LAST_ONOPEN",
      new Date().toISOString()
    );
  } catch (e) {
    // ignore
  }
  console.log(`${CONFIG.LOG_PREFIX} onOpen fired at ${new Date().toISOString()}`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);

  buildMenu();

  // Silent health check (non-blocking, no prompts)
  try {
    ftHealthCheckSilent();
  } catch (_e) {
    // ignore
  }

  // First-time guidance: ask user to run init (explicit consent)
  try {
    if (!isInitialized()) {
      ss.toast(
        "Première utilisation : autorisez le script.\nMenu France Travail » Initialiser / Autoriser",
        "France Travail",
        20
      );
    }
  } catch (_e) {
    // ignore
  }

  // Non-blocking hint if secrets are missing
  try {
    if (!getSecrets()) {
      ss.toast(
        "Secrets France Travail manquants.\nMenu France Travail » Configurer les secrets.",
        "France Travail",
        20
      );
      // Offer a one-click action (user can cancel)
      ftShowSecretsMissing();
    }
  } catch (e) {
    // ignore
  }
}

export function buildMenu(): void {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("France Travail")
    .addItem("Initialiser", "ftInit")
    .addItem("Health check", "ftHealthCheck")
    .addSeparator()
    .addItem("Mettre à jour (24h)", "ftUpdateTravailleurSocial_24h")
    .addItem("Mettre à jour (7j)", "ftUpdateTravailleurSocial_7j")
    .addItem("Mettre à jour (31j)", "ftUpdateTravailleurSocial_31j")
    .addSeparator()
    .addItem("Configurer les secrets", "ftConfigureSecrets")
    .addItem("Ouvrir l’onglet Exclusions", "ftOpenExclusions")
    .addSeparator()
    .addItem("Aide / README", "ftHelp")
    .addToUi();
}

/**
 * Opens a non-blocking popup with a single action to launch secret configuration.
 */
export function ftShowSecretsMissing(): void {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "France Travail",
    "Secrets manquants.\n\nCliquez sur OK pour lancer : Configurer les secrets.",
    ui.ButtonSet.OK_CANCEL
  );

  if (resp === ui.Button.OK) {
    ftConfigureSecrets();
  }
}

export function ftConfigureSecrets(): void {
  promptAndStoreSecrets();
  SpreadsheetApp.getUi().alert("Secrets enregistrés dans Script Properties.");
}

export function ftOpenExclusions(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);
  activateSheet(ss, CONFIG.SHEET_EXCLUSIONS);
}

export function ftHelp(): void {
  const msg =
    "Outil France Travail (Offres v2)\n\n" +
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

/**
 * Manual debug entrypoint: run it from Apps Script editor.
 * - Writes a cell in the active sheet
 * - Writes Script Properties marker
 */
export function ftDebugPing(): void {
  const ts = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty("FT_DEBUG_PING", ts);

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheets()[0];
  sheet.getRange("A1").setValue(`FT_DEBUG_PING ${ts}`);

  console.log(`${CONFIG.LOG_PREFIX} ftDebugPing ${ts}`);
}

// Re-export job functions as global symbols
export {
  ftUpdateTravailleurSocial_24h,
  ftUpdateTravailleurSocial_7j,
  ftUpdateTravailleurSocial_31j,
  // keep alias exported for compatibility (existing scripts/triggers)
  ftUpdateTravailleurSocial_30j,
};

/**
 * ---- GAS global entrypoints ----
 * Apps Script discovers runnable functions from the global scope.
 * With an IIFE bundle, we must explicitly attach them to the global object.
 */
const G = (function () {
  // In Apps Script, top-level `this` is the global object.
  // Use Function("return this")() to be resilient to bundling/strict mode.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return Function("return this")() as any;
})();

G.onOpen = onOpen;
G.buildMenu = buildMenu;
G.ftInit = ftInit;
G.ftConfigureSecrets = ftConfigureSecrets;
G.ftOpenExclusions = ftOpenExclusions;
G.ftHelp = ftHelp;
G.ftUpdateTravailleurSocial_24h = ftUpdateTravailleurSocial_24h;
G.ftUpdateTravailleurSocial_7j = ftUpdateTravailleurSocial_7j;
G.ftUpdateTravailleurSocial_31j = ftUpdateTravailleurSocial_31j;
G.ftUpdateTravailleurSocial_30j = ftUpdateTravailleurSocial_30j;
G.ftDebugPing = ftDebugPing;
G.ftShowSecretsMissing = ftShowSecretsMissing;
G.ftHealthCheckSilent = ftHealthCheckSilent;
G.ftHealthCheck = ftHealthCheck;
