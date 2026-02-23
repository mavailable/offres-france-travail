import { CONFIG } from "./config";
import { getSecrets, promptAndStoreSecrets, ftSetSecretsFromDialog } from "./secrets";
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

function runHealthChecks(opts: { includeTriggerCheck: boolean }): {
  items: {
    key: "properties" | "cache" | "secrets" | "dailyTrigger";
    label: string;
    ok: boolean;
    help?: { label: string; href?: string; hint?: string; action?: "init" | "secrets" }[];
  }[];
  helpSecretsUrl: string;
} {
  const helpSecretsUrl = "https://francetravail.io/compte/applications/";

  const items: {
    key: "properties" | "cache" | "secrets" | "dailyTrigger";
    label: string;
    ok: boolean;
    help?: { label: string; href?: string; hint?: string; action?: "init" | "secrets" }[];
  }[] = [];

  // Services
  items.push({
    key: "properties",
    label: "Propriétés du script",
    ok: canUseProperties(),
  });
  items.push({ key: "cache", label: "CacheService", ok: canUseCache() });

  // Secrets
  const secretsOk = (() => {
    try {
      return Boolean(getSecrets());
    } catch (_e) {
      return false;
    }
  })();

  items.push({
    key: "secrets",
    label: "Secrets FT_CLIENT_ID / FT_CLIENT_SECRET",
    ok: secretsOk,
    help: [
      {
        label: "Configurer les secrets",
        hint: "France Travail > Configurer les secrets",
        action: "secrets",
      },
      { label: "Créer/voir l'application", href: helpSecretsUrl },
    ],
  });

  // Daily trigger (more precise messaging)
  if (opts.includeTriggerCheck) {
    const triggersAccessible = canUseTriggers();
    if (!triggersAccessible) {
      items.push({
        key: "dailyTrigger",
        label: "Déclencheur quotidien 00h (accès triggers non autorisé)",
        ok: false,
        help: [
          {
            label: "Initialiser",
            hint: "France Travail > Initialiser",
            action: "init",
          },
        ],
      });
    } else {
      const hasDaily = hasDailyMidnightTrigger();
      items.push({
        key: "dailyTrigger",
        label: hasDaily ? "Déclencheur quotidien 00h" : "Déclencheur quotidien 00h (absent)",
        ok: hasDaily,
        help: [
          {
            label: "Initialiser",
            hint: "France Travail > Initialiser",
            action: "init",
          },
        ],
      });
    }
  }

  return { items, helpSecretsUrl };
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

  const { items } = runHealthChecks({ includeTriggerCheck: false });

  // Convert KO items to messages (silent mode)
  for (const it of items) {
    if (it.ok) continue;
    if (it.key === "properties") issues.push("Propriétés du script (Script Properties): non autorisé.");
    else if (it.key === "cache") issues.push("CacheService: non autorisé.");
    else if (it.key === "secrets") issues.push("Secrets manquants (FT_CLIENT_ID / FT_CLIENT_SECRET)." );
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

  const { items, helpSecretsUrl } = runHealthChecks({ includeTriggerCheck: true });

  const title = "France Travail » Health check";
  const allOk = items.every((i) => i.ok);
  if (allOk) {
    ui.alert(
      title,
      "✅ Tout est OK.\n\nSecrets présents, droits valides et déclencheur quotidien en place.",
      ui.ButtonSet.OK
    );
    return;
  }

  // Prefer a clearer HtmlService dialog when available.
  const canUseHtml = (() => {
    try {
      return Boolean(HtmlService && SpreadsheetApp && SpreadsheetApp.getUi);
    } catch (_e) {
      return false;
    }
  })();

  if (canUseHtml) {
    const lines = items
      .map((i) => {
        const icon = i.ok ? "✅" : "❌";
        const help = !i.ok && i.help?.length
          ? `<div class="help">${i.help
              .map((h) => {
                if (h.action === "init") {
                  return `<button class="linklike" onclick="runInit()">${h.label}</button>`;
                }
                if (h.action === "secrets") {
                  return `<button class="linklike" onclick="runSecrets()">${h.label}</button>`;
                }
                if (h.href) {
                  return `<a href="${h.href}" target="_blank" rel="noreferrer">${h.label}</a>`;
                }
                return `<span class="hint">${h.label} : <b>${h.hint || ""}</b></span>`;
              })
              .join(" · ")}</div>`
          : "";
        return `<div class="row"><div class="left">${icon}</div><div class="right"><div class="label">${i.label}</div>${help}</div></div>`;
      })
      .join("\n");

    const html = HtmlService.createHtmlOutput(`<!doctype html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root{--text:#111827;--muted:#6b7280;--border:#e5e7eb;--bg:#ffffff;--primary:#2563eb;}
      *{box-sizing:border-box;}
      body{margin:0;background:var(--bg);color:var(--text);font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;}
      .wrap{padding:14px;}
      .card{border:1px solid var(--border);border-radius:12px;background:#fff;padding:12px;}
      h2{margin:0 0 8px 0;font-size:15px;}
      .row{display:flex;gap:10px;padding:10px 8px;border:1px solid var(--border);border-radius:10px;align-items:flex-start;margin-top:8px;}
      .left{width:22px;flex:0 0 22px;line-height:1.2;font-size:16px;}
      .label{font-size:13px;font-weight:600;}
      .help{margin-top:4px;font-size:12px;color:var(--muted);}
      a{color:var(--primary);text-decoration:none;}
      a:hover{text-decoration:underline;}
      .hint b{color:#111827;}
      .linklike{border:0;background:transparent;color:var(--primary);padding:0;margin:0;font:inherit;cursor:pointer;}
      .linklike:hover{text-decoration:underline;}
      .actions{margin-top:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;}
      .btn{border-radius:10px;padding:9px 12px;font-size:13px;border:1px solid var(--border);background:#fff;cursor:pointer;}
      .btn-primary{border-color:transparent;background:var(--primary);color:#fff;font-weight:600;}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h2>Health check</h2>
        ${lines}
        <div class="actions">
          <div style="font-size:12px;color:var(--muted);">Lien secrets: <a href="${helpSecretsUrl}" target="_blank" rel="noreferrer">${helpSecretsUrl}</a></div>
          <div style="display:flex;gap:10px;">
            <button class="btn" onclick="google.script.host.close()">Fermer</button>
            <button class="btn btn-primary" onclick="runInit()">Initialiser</button>
            <button class="btn btn-primary" onclick="runSecrets()">Configurer les secrets</button>
          </div>
        </div>
      </div>
    </div>

    <script>
      function runInit(){
        google.script.run
          .withSuccessHandler(() => google.script.host.close())
          .withFailureHandler(err => alert((err && err.message) ? err.message : String(err)))
          .ftInit();
      }
      function runSecrets(){
        google.script.run
          .withSuccessHandler(() => google.script.host.close())
          .withFailureHandler(err => alert((err && err.message) ? err.message : String(err)))
          .ftConfigureSecrets();
      }
    </script>
  </body>
</html>`)
      .setWidth(620)
      .setHeight(420);

    ui.showModalDialog(html, title);
    return;
  }

  // Fallback plain alert
  const msg =
    items
      .map((i) => `${i.ok ? "✅" : "❌"} ${i.label}`)
      .join("\n") +
    "\n\nCorrections :\n" +
    "» France Travail > Initialiser\n" +
    "» France Travail > Configurer les secrets\n" +
    `» Lien secrets: ${helpSecretsUrl}`;

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

  // If secrets are missing, open the single 2-field dialog.
  // The dialog will call ftSetSecretsFromDialogAndFinalizeInit() which will:
  // - store secrets
  // - create trigger
  // - mark init done
  if (!getSecrets()) {
    try {
      promptAndStoreSecrets();
    } catch (_e) {
      // promptAndStoreSecrets() opens an async HtmlService dialog and throws a
      // guidance error while secrets are still missing. Keep init non-blocking.
    }

    // Non-blocking guidance (avoid an extra modal on top of the secrets dialog)
    try {
      ss.toast(
        "Renseignez FT_CLIENT_ID et FT_CLIENT_SECRET puis cliquez sur « Enregistrer ».\n\nL’initialisation se terminera automatiquement.",
        "France Travail",
        20
      );
    } catch (_e) {
      // fallback if toast not allowed
      ui.alert(
        "France Travail",
        "Renseignez FT_CLIENT_ID et FT_CLIENT_SECRET puis cliquez sur « Enregistrer ».\n\nL’initialisation se terminera automatiquement.",
        ui.ButtonSet.OK
      );
    }
    return;
  }

  finalizeInit();

  ui.alert(
    "France Travail",
    "Initialisation OK.\n\nLe déclencheur quotidien (00h) est en place.",
    ui.ButtonSet.OK
  );
}

function finalizeInit(): void {
  ensureDailyMidnightTrigger();
  PropertiesService.getScriptProperties().setProperty(INIT_PROP_KEY, "1");
}

export function ftSetSecretsFromDialogAndFinalizeInit(secrets: { clientId: string; clientSecret: string }): void {
  // Store secrets
  ftSetSecretsFromDialog(secrets);

  // Finish init steps
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);
  finalizeInit();

  // Notify user (non-blocking)
  try {
    ss.toast("Secrets enregistrés. Initialisation terminée.", "France Travail", 8);
  } catch (_e) {
    // ignore
  }
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

  // NOTE: we intentionally do NOT check FT secrets during onOpen anymore.
  // Rationale: onOpen can run in restricted contexts, and we want to avoid
  // any secret-related reads / prompts / alerts at spreadsheet open.
  // Use menu actions instead:
  // - France Travail » Initialiser (will prompt if secrets missing)
  // - France Travail » Health check
  // - France Travail » Configurer les secrets
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

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    ss.toast("Secrets enregistrés dans Script Properties.", "France Travail", 8);
  } catch (_e) {
    SpreadsheetApp.getUi().alert("Secrets enregistrés dans Script Properties.");
  }
}

export function ftOpenExclusions(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);
  activateSheet(ss, CONFIG.SHEET_EXCLUSIONS);
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
G.ftUpdateTravailleurSocial_24h = ftUpdateTravailleurSocial_24h;
G.ftUpdateTravailleurSocial_7j = ftUpdateTravailleurSocial_7j;
G.ftUpdateTravailleurSocial_31j = ftUpdateTravailleurSocial_31j;
G.ftUpdateTravailleurSocial_30j = ftUpdateTravailleurSocial_30j;
G.ftDebugPing = ftDebugPing;
G.ftShowSecretsMissing = ftShowSecretsMissing;
G.ftHealthCheckSilent = ftHealthCheckSilent;
G.ftHealthCheck = ftHealthCheck;

// Expose secret dialog callback (used by HtmlService dialog)
G.ftSetSecretsFromDialog = ftSetSecretsFromDialog;
G.ftSetSecretsFromDialogAndFinalizeInit = ftSetSecretsFromDialogAndFinalizeInit;
