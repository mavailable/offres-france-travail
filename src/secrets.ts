import { CONFIG } from "./config";

export interface FtSecrets {
  clientId: string;
  clientSecret: string;
}

export function getSecrets(): FtSecrets | null {
  const props = PropertiesService.getScriptProperties();
  const clientId = (props.getProperty(CONFIG.SECRETS.CLIENT_ID) || "").trim();
  const clientSecret = (props.getProperty(CONFIG.SECRETS.CLIENT_SECRET) || "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function setSecrets(secrets: FtSecrets): void {
  const props = PropertiesService.getScriptProperties();
  // IMPORTANT: do NOT delete other script properties (OpenAI config, init markers, etc.)
  props.setProperties({
    [CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
    [CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim(),
  });
}

/**
 * Show a UI prompt to collect secrets and store them in Script Properties.
 * If user cancels, throws.
 */
export function promptAndStoreSecrets(): FtSecrets {
  const ui = SpreadsheetApp.getUi();

  const helpLink = "https://francetravail.io/compte/applications/";
  const title = "Configuration France Travail";

  const r1 = ui.prompt(
    title,
    "Mes secrets France Travail\n" + helpLink + "\n\n" + "Saisir FT_CLIENT_ID (client_id):",
    ui.ButtonSet.OK_CANCEL
  );
  if (r1.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (FT_CLIENT_ID manquant).");
  }
  const clientId = (r1.getResponseText() || "").trim();
  if (!clientId) throw new Error("FT_CLIENT_ID est vide.");

  const r2 = ui.prompt(
    title,
    "Mes secrets France Travail\n" + helpLink + "\n\n" + "Saisir FT_CLIENT_SECRET (client_secret):",
    ui.ButtonSet.OK_CANCEL
  );
  if (r2.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (FT_CLIENT_SECRET manquant).");
  }
  const clientSecret = (r2.getResponseText() || "").trim();
  if (!clientSecret) throw new Error("FT_CLIENT_SECRET est vide.");

  const secrets = { clientId, clientSecret };
  setSecrets(secrets);
  return secrets;
}

/**
 * Ensure secrets exist. If missing:
 * - if allowUi=true, prompts the user and stores them.
 * - else throws a clear error.
 */
export function ensureSecrets(allowUi: boolean): FtSecrets {
  const existing = getSecrets();
  if (existing) return existing;

  if (!allowUi) {
    throw new Error(
      "Secrets France Travail manquants. Ouvrez le Google Sheet puis utilisez le menu France Travail > Configurer les secrets."
    );
  }
  return promptAndStoreSecrets();
}
