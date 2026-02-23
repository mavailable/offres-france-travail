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
  props.setProperties(
    {
      [CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
      [CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim(),
    },
    true
  );
}

function canUseHtmlDialog(): boolean {
  try {
    return Boolean(HtmlService && SpreadsheetApp && SpreadsheetApp.getUi);
  } catch (_e) {
    return false;
  }
}

function promptBlockingSecrets(ui: GoogleAppsScript.Base.Ui, title: string, helpLink: string): FtSecrets {
  const r1 = ui.prompt(
    title,
    "Mes secrets France Travail\n" + helpLink + "\n\n" + "Saisir FT_CLIENT_ID (client_id):",
    ui.ButtonSet.OK_CANCEL
  );
  if (r1.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (FT_CLIENT_ID manquant)." );
  }
  const clientId = (r1.getResponseText() || "").trim();
  if (!clientId) throw new Error("FT_CLIENT_ID est vide.");

  const r2 = ui.prompt(
    title,
    "Mes secrets France Travail\n" + helpLink + "\n\n" + "Saisir FT_CLIENT_SECRET (client_secret):",
    ui.ButtonSet.OK_CANCEL
  );
  if (r2.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (FT_CLIENT_SECRET manquant)." );
  }
  const clientSecret = (r2.getResponseText() || "").trim();
  if (!clientSecret) throw new Error("FT_CLIENT_SECRET est vide.");

  const secrets = { clientId, clientSecret };
  setSecrets(secrets);
  return secrets;
}

/**
 * Show a UI dialog to collect secrets and store them in Script Properties.
 *
 * UX rules:
 * - When UI is available, always open the single 2-field HtmlService dialog.
 * - In restricted/no-HTML contexts, fallback to blocking prompts.
 *
 * Note: HtmlService dialogs are asynchronous; this function will throw a clear
 * message when secrets are still missing after opening the dialog.
 */
export function promptAndStoreSecrets(): FtSecrets {
  const ui = SpreadsheetApp.getUi();

  const helpLink = "https://francetravail.io/compte/applications/";
  const title = "Configuration France Travail";

  // Preferred UX (single form)
  if (canUseHtmlDialog()) {
    const html = HtmlService.createHtmlOutput(
      `<!doctype html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root{
        --bg:#ffffff;
        --text:#111827;
        --muted:#6b7280;
        --border:#e5e7eb;
        --ring:#93c5fd;
        --primary:#2563eb;
        --primary-hover:#1d4ed8;
      }
      *{box-sizing:border-box;}
      body{
        margin:0;
        background:var(--bg);
        color:var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      }
      .wrap{padding:14px 14px 10px;}
      .card{
        border:1px solid var(--border);
        border-radius:12px;
        padding:12px 12px 10px;
        background:#fff;
      }
      .head{display:flex;gap:12px;align-items:flex-start;}
      .badge{
        width:36px;height:36px;flex:0 0 36px;
        border-radius:10px;
        background:rgba(37,99,235,.12);
        display:flex;align-items:center;justify-content:center;
        color:var(--primary);
        font-weight:700;
      }
      h2{margin:0;font-size:15px;line-height:1.3;}
      .sub{margin:4px 0 0 0;font-size:12px;color:var(--muted);}
      a{color:var(--primary);text-decoration:none;}
      a:hover{text-decoration:underline;}
      .grid{margin-top:10px;display:grid;gap:10px;}
      label{display:block;font-size:12px;color:#374151;margin-bottom:6px;}
      input{
        width:100%;
        padding:10px 10px;
        font-size:13px;
        border:1px solid var(--border);
        border-radius:10px;
        outline:none;
      }
      input:focus{
        border-color:var(--ring);
        box-shadow:0 0 0 3px rgba(147,197,253,.55);
      }
      .row{
        margin-top:10px;
        display:flex;
        gap:10px;
        justify-content:flex-end;
        align-items:center;
      }
      .btn{
        border-radius:10px;
        padding:9px 12px;
        font-size:13px;
        border:1px solid var(--border);
        background:#fff;
        cursor:pointer;
      }
      .btn:hover{background:#f9fafb;}
      .btn-primary{
        border-color:transparent;
        background:var(--primary);
        color:#fff;
        font-weight:600;
      }
      .btn-primary:hover{background:var(--primary-hover);}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="head">
          <div class="badge">FT</div>
          <div>
            <h2>Renseigner les secrets France Travail</h2>
            <p class="sub">
              Les secrets restent stockés dans les <b>Script Properties</b> de ce Google Sheet.
              <br />
              Lien : <a href="${helpLink}" target="_blank" rel="noreferrer">${helpLink}</a>
            </p>
          </div>
        </div>

        <div class="grid">
          <div>
            <label for="clientId">FT_CLIENT_ID <span class="sub">(client_id)</span></label>
            <input id="clientId" type="text" autocomplete="off" spellcheck="false" placeholder="ex: 12345678-aaaa-bbbb-cccc-1234567890ab" />
          </div>

          <div>
            <label for="clientSecret">FT_CLIENT_SECRET <span class="sub">(client_secret)</span></label>
            <input id="clientSecret" type="password" autocomplete="off" spellcheck="false" placeholder="ex: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>
        </div>

        <div class="row">
          <button class="btn" onclick="google.script.host.close()">Annuler</button>
          <button id="saveBtn" class="btn btn-primary" onclick="submitSecrets()">Enregistrer</button>
        </div>
      </div>
    </div>

    <script>
      function submitSecrets(){
        const clientId = (document.getElementById('clientId').value || '').trim();
        const clientSecret = (document.getElementById('clientSecret').value || '').trim();
        if(!clientId){
          alert('FT_CLIENT_ID est vide.');
          return;
        }
        if(!clientSecret){
          alert('FT_CLIENT_SECRET est vide.');
          return;
        }
        google.script.run
          .withSuccessHandler(() => google.script.host.close())
          .withFailureHandler(err => alert((err && err.message) ? err.message : String(err)))
          .ftSetSecretsFromDialogAndFinalizeInit({ clientId, clientSecret });
      }

      function onKeyDown(e){
        if(e && e.key === 'Enter'){
          e.preventDefault();
          submitSecrets();
        }
      }
      document.getElementById('clientId').addEventListener('keydown', onKeyDown);
      document.getElementById('clientSecret').addEventListener('keydown', onKeyDown);
      document.getElementById('saveBtn').focus();
    </script>
  </body>
</html>`
    )
      .setWidth(560)
      .setHeight(320);

    ui.showModalDialog(html, title);

    const stored = getSecrets();
    if (!stored) {
      throw new Error(
        "Fenêtre ouverte. Renseignez FT_CLIENT_ID et FT_CLIENT_SECRET puis cliquez sur Enregistrer."
      );
    }
    return stored;
  }

  // Fallback for restricted contexts
  return promptBlockingSecrets(ui, title, helpLink);
}

/**
 * Internal entrypoint used by the HTML dialog.
 */
export function ftSetSecretsFromDialog(secrets: FtSecrets): void {
  const clientId = (secrets?.clientId || "").trim();
  const clientSecret = (secrets?.clientSecret || "").trim();
  if (!clientId) throw new Error("FT_CLIENT_ID est vide.");
  if (!clientSecret) throw new Error("FT_CLIENT_SECRET est vide.");
  setSecrets({ clientId, clientSecret });
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
