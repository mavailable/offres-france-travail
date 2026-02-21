/* Bundled with esbuild for Google Apps Script */

"use strict";
  // src/config.ts
  var CONFIG = {
    // Sheets
    SHEET_OFFRES: "Offres",
    SHEET_EXCLUSIONS: "Exclusions",
    SHEET_IMPORT: "Import",
    // Search query (France Travail Offres v2)
    SEARCH_KEYWORDS: "travailleur social",
    PUBLIEE_DEPUIS_DAYS: 1,
    // Pagination
    PAGE_SIZE: 150,
    MAX_PAGES: 20,
    // API endpoints (override here if France Travail changes)
    OAUTH_TOKEN_URL: "https://entreprise.pole-emploi.fr/connexion/oauth2/access_token?realm=/partenaire",
    OFFRES_SEARCH_URL: "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search",
    // Token cache
    TOKEN_CACHE_KEY: "FT_OAUTH_TOKEN_JSON",
    TOKEN_CACHE_TTL_SECONDS: 50 * 60,
    // 50 minutes
    // Column definitions (1-based indexes)
    COLS: {
      dateCreation: 1,
      intitule: 2,
      resume: 3,
      entrepriseNom: 4,
      contactNom: 5,
      codePostal: 6,
      typeContrat: 7,
      dureeTravail: 8,
      contactEmail: 9,
      // I
      contactTelephone: 10,
      // J
      entrepriseAPropos: 11,
      // K
      offreId: 12,
      // L (technical, hidden)
      TOTAL: 12
    },
    // Formatting
    HEADER_ROW: 1,
    DATA_START_ROW: 2,
    ROW_HEIGHT_PX: 21,
    // Column widths (px)
    COL_WIDTHS: {
      dateCreation: 75,
      intitule: 300,
      resume: 200,
      entrepriseNom: 150,
      contactNom: 150,
      codePostal: 75,
      typeContrat: 75,
      dureeTravail: 75,
      contactEmail: 100,
      contactTelephone: 100,
      entrepriseAPropos: 100,
      offreId: 80
      // hidden anyway
    },
    // Notes
    RESUME_NOTE_PREFIX: "Description:\n",
    // Secrets keys (Script Properties)
    SECRETS: {
      CLIENT_ID: "FT_CLIENT_ID",
      CLIENT_SECRET: "FT_CLIENT_SECRET"
    },
    // Logging
    LOG_PREFIX: "[FT]"
  };
  var HEADERS_OFFRES = [
    "Date",
    "Poste",
    "R\xE9sum\xE9",
    "Entreprise",
    "Contact",
    "CP",
    "Contrat",
    "ETP",
    "Email",
    "T\xE9l\xE9phone",
    "\xC0 propos",
    "offre_ID"
  ];
  var HEADERS_EXCLUSIONS = [
    "Exclure si intitul\xE9 contient / match",
    "Exclure si entreprise contient / match"
  ];

  // src/secrets.ts
  function getSecrets() {
    const props = PropertiesService.getScriptProperties();
    const clientId = (props.getProperty(CONFIG.SECRETS.CLIENT_ID) || "").trim();
    const clientSecret = (props.getProperty(CONFIG.SECRETS.CLIENT_SECRET) || "").trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }
  function setSecrets(secrets) {
    const props = PropertiesService.getScriptProperties();
    props.setProperties(
      {
        [CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
        [CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim()
      },
      true
    );
  }
  function promptAndStoreSecrets() {
    const ui = SpreadsheetApp.getUi();
    const helpLink = "https://francetravail.io/compte/applications/";
    const title = "Configuration France Travail";
    const r1 = ui.prompt(
      title,
      "Mes secrets France Travail\n" + helpLink + "\n\nSaisir FT_CLIENT_ID (client_id):",
      ui.ButtonSet.OK_CANCEL
    );
    if (r1.getSelectedButton() !== ui.Button.OK) {
      throw new Error("Configuration annul\xE9e (FT_CLIENT_ID manquant).");
    }
    const clientId = (r1.getResponseText() || "").trim();
    if (!clientId) throw new Error("FT_CLIENT_ID est vide.");
    const r2 = ui.prompt(
      title,
      "Mes secrets France Travail\n" + helpLink + "\n\nSaisir FT_CLIENT_SECRET (client_secret):",
      ui.ButtonSet.OK_CANCEL
    );
    if (r2.getSelectedButton() !== ui.Button.OK) {
      throw new Error("Configuration annul\xE9e (FT_CLIENT_SECRET manquant).");
    }
    const clientSecret = (r2.getResponseText() || "").trim();
    if (!clientSecret) throw new Error("FT_CLIENT_SECRET est vide.");
    const secrets = { clientId, clientSecret };
    setSecrets(secrets);
    return secrets;
  }
  function ensureSecrets(allowUi) {
    const existing = getSecrets();
    if (existing) return existing;
    if (!allowUi) {
      throw new Error(
        "Secrets France Travail manquants. Ouvrez le Google Sheet puis utilisez le menu France Travail > Configurer les secrets."
      );
    }
    return promptAndStoreSecrets();
  }

  // src/ftApi.ts
  function urlEncodeForm(data) {
    return Object.keys(data).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(data[k])).join("&");
  }
  function fetchJson(url, params) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, ...params });
    const code = res.getResponseCode();
    const rawText = res.getContentText() || "";
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch (_e) {
      json = null;
    }
    return { code, json, rawText };
  }
  function getToken(secrets) {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(CONFIG.TOKEN_CACHE_KEY);
    if (cached) {
      try {
        const obj = JSON.parse(cached);
        if (obj.access_token) return obj.access_token;
      } catch (_e) {
      }
    }
    const payload = urlEncodeForm({
      grant_type: "client_credentials",
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
      scope: "api_offresdemploiv2 o2dsoffre"
      // tolerant (FT accepts various scopes per app)
    });
    const { code, json, rawText } = fetchJson(CONFIG.OAUTH_TOKEN_URL, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload,
      headers: {
        Accept: "application/json"
      }
    });
    if (code < 200 || code >= 300 || !json || !json.access_token) {
      throw new Error(
        `\u274C OAuth token error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
      );
    }
    const token = json.access_token;
    cache.put(CONFIG.TOKEN_CACHE_KEY, JSON.stringify({ access_token: token }), CONFIG.TOKEN_CACHE_TTL_SECONDS);
    return token;
  }
  function clearTokenCache() {
    CacheService.getScriptCache().remove(CONFIG.TOKEN_CACHE_KEY);
  }
  function mapOffer(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    if (!o) return null;
    const id = String((_a = o.id) != null ? _a : "").trim();
    if (!id) return null;
    const entrepriseNom = String((_d = (_c = (_b = o.entreprise) == null ? void 0 : _b.nom) != null ? _c : o.entrepriseNom) != null ? _d : "");
    let contactNomRaw = String((_g = (_f = (_e = o.contact) == null ? void 0 : _e.nom) != null ? _f : o.contactNom) != null ? _g : "").trim();
    if (/^Agence France/i.test(contactNomRaw)) {
      contactNomRaw = "";
    } else {
      const parts = contactNomRaw.split(" - ");
      if (parts.length >= 2) contactNomRaw = parts.slice(1).join(" - ").trim();
    }
    const entrepriseAProposRaw = String((_i = (_h = o.entreprise) == null ? void 0 : _h.description) != null ? _i : "").trim();
    return {
      id,
      dateCreation: String((_j = o.dateCreation) != null ? _j : ""),
      intitule: String((_k = o.intitule) != null ? _k : ""),
      description: String((_l = o.description) != null ? _l : ""),
      entrepriseNom,
      contactNom: contactNomRaw,
      contactEmail: String((_o = (_n = (_m = o.contact) == null ? void 0 : _m.email) != null ? _n : o.contactEmail) != null ? _o : ""),
      contactTelephone: String((_r = (_q = (_p = o.contact) == null ? void 0 : _p.telephone) != null ? _q : o.contactTelephone) != null ? _r : ""),
      entrepriseAPropos: entrepriseAProposRaw,
      codePostal: String((_u = (_t = (_s = o.lieuTravail) == null ? void 0 : _s.codePostal) != null ? _t : o.codePostal) != null ? _u : ""),
      typeContratLibelle: String((_v = o.typeContratLibelle) != null ? _v : ""),
      dureeTravailLibelle: String((_w = o.dureeTravailLibelle) != null ? _w : "")
    };
  }
  function buildOfferUrl(offerId) {
    return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(offerId)}`;
  }
  function getOfferPublicUrl(offerId) {
    return buildOfferUrl(offerId);
  }
  function searchOffersPaged(secrets, opts) {
    const all = [];
    let start = 0;
    for (let page = 0; page < CONFIG.MAX_PAGES; page++) {
      const end = start + CONFIG.PAGE_SIZE - 1;
      const range = `${start}-${end}`;
      const pageOffers = searchOffersOnce(
        secrets,
        opts,
        range,
        /*allowRetry401*/
        true
      );
      if (!pageOffers.length) break;
      all.push(...pageOffers);
      if (pageOffers.length < CONFIG.PAGE_SIZE) break;
      start += CONFIG.PAGE_SIZE;
    }
    return all;
  }
  function searchOffersOnce(secrets, opts, range, allowRetry401) {
    const token = getToken(secrets);
    const qs = `motsCles=${encodeURIComponent(opts.motsCles)}&publieeDepuis=${encodeURIComponent(String(opts.publieeDepuis))}&range=${encodeURIComponent(range)}`;
    const url = `${CONFIG.OFFRES_SEARCH_URL}?${qs}`;
    const { code, json, rawText } = fetchJson(url, {
      method: "get",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    if (code === 401 && allowRetry401) {
      clearTokenCache();
      return searchOffersOnce(secrets, opts, range, false);
    }
    if (code < 200 || code >= 300) {
      throw new Error(
        `\u274C FT search error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
      );
    }
    const results = json && (json.resultats || json.results || json.offres);
    const arr = Array.isArray(results) ? results : [];
    return arr.map(mapOffer).filter((x) => Boolean(x));
  }

  // src/sheet.ts
  function firstLine(text) {
    const s = (text || "").replace(/\r\n/g, "\n");
    const line = s.split("\n")[0] || "";
    return line.trim();
  }
  function ensureSheets(ss) {
    let offres = ss.getSheetByName(CONFIG.SHEET_OFFRES);
    let offresWasCreated = false;
    if (!offres) {
      offres = ss.insertSheet(CONFIG.SHEET_OFFRES);
      offresWasCreated = true;
    }
    let exclusions = ss.getSheetByName(CONFIG.SHEET_EXCLUSIONS);
    if (!exclusions) {
      exclusions = ss.insertSheet(CONFIG.SHEET_EXCLUSIONS);
      setupExclusionsSheet(exclusions);
    } else {
      ensureExclusionsHeaders(exclusions);
    }
    let importSheet = ss.getSheetByName(CONFIG.SHEET_IMPORT);
    if (!importSheet) {
      importSheet = ss.insertSheet(CONFIG.SHEET_IMPORT);
      setupImportSheet(importSheet);
    } else {
      ensureImportHeaders(importSheet);
    }
    try {
      importSheet.hideSheet();
    } catch (_e) {
    }
    ensureOffresHeaders(offres);
    ensureOffresFormatting(offres, offresWasCreated);
    return { offres, exclusions, importSheet, offresWasCreated };
  }
  function ensureOffresHeaders(sheet) {
    const headerRange = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, CONFIG.COLS.TOTAL);
    const current = headerRange.getValues()[0].map(String);
    const expected = HEADERS_OFFRES;
    const same = current.length === expected.length && expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same) {
      headerRange.setValues([expected]);
    }
    sheet.setFrozenRows(1);
    headerRange.setFontWeight("bold").setBackground("#f1f3f4").setHorizontalAlignment("center");
  }
  function ensureOffresFormatting(sheet, isFirstSetup) {
    sheet.setColumnWidth(CONFIG.COLS.dateCreation, CONFIG.COL_WIDTHS.dateCreation);
    sheet.setColumnWidth(CONFIG.COLS.intitule, CONFIG.COL_WIDTHS.intitule);
    sheet.setColumnWidth(CONFIG.COLS.resume, CONFIG.COL_WIDTHS.resume);
    sheet.setColumnWidth(CONFIG.COLS.entrepriseNom, CONFIG.COL_WIDTHS.entrepriseNom);
    sheet.setColumnWidth(CONFIG.COLS.contactNom, CONFIG.COL_WIDTHS.contactNom);
    sheet.setColumnWidth(CONFIG.COLS.codePostal, CONFIG.COL_WIDTHS.codePostal);
    sheet.setColumnWidth(CONFIG.COLS.typeContrat, CONFIG.COL_WIDTHS.typeContrat);
    sheet.setColumnWidth(CONFIG.COLS.dureeTravail, CONFIG.COL_WIDTHS.dureeTravail);
    sheet.setColumnWidth(CONFIG.COLS.contactEmail, CONFIG.COL_WIDTHS.contactEmail);
    sheet.setColumnWidth(CONFIG.COLS.contactTelephone, CONFIG.COL_WIDTHS.contactTelephone);
    sheet.setColumnWidth(CONFIG.COLS.entrepriseAPropos, CONFIG.COL_WIDTHS.entrepriseAPropos);
    sheet.setColumnWidth(CONFIG.COLS.offreId, CONFIG.COL_WIDTHS.offreId);
    sheet.hideColumns(CONFIG.COLS.offreId);
    const maxRows = Math.max(sheet.getMaxRows(), 200);
    if (sheet.getMaxRows() < maxRows) sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
    const dataRange = sheet.getRange(1, 1, maxRows, CONFIG.COLS.TOTAL);
    dataRange.setWrap(false).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    const heightRows = Math.min(maxRows, 1e3);
    sheet.setRowHeights(1, heightRows, CONFIG.ROW_HEIGHT_PX);
    sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.COLS.dateCreation, maxRows - 1, 1).setNumberFormat("dd/MM/yyyy");
    if (isFirstSetup) {
    }
  }
  function setupExclusionsSheet(sheet) {
    sheet.getRange(1, 1, 1, 2).setValues([HEADERS_EXCLUSIONS]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 360);
    sheet.setColumnWidth(2, 360);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
  }
  function ensureExclusionsHeaders(sheet) {
    const headerRange = sheet.getRange(1, 1, 1, 2);
    const current = headerRange.getValues()[0].map(String);
    const expected = HEADERS_EXCLUSIONS;
    const same = expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same) headerRange.setValues([expected]);
    sheet.setFrozenRows(1);
  }
  function setupImportSheet(sheet) {
    sheet.getRange(1, 1, 1, 2).setValues([["offre_id", "raw_json"]]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 600);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
  }
  function ensureImportHeaders(sheet) {
    const headerRange = sheet.getRange(1, 1, 1, 2);
    const current = headerRange.getValues()[0].map(String);
    const expected = ["offre_id", "raw_json"];
    const same = expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same) headerRange.setValues([expected]);
    sheet.setFrozenRows(1);
  }
  function loadExistingOfferIds(offresSheet) {
    var _a;
    const lastRow = offresSheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) return /* @__PURE__ */ new Set();
    const numRows = lastRow - CONFIG.HEADER_ROW;
    const range = offresSheet.getRange(CONFIG.DATA_START_ROW, CONFIG.COLS.offreId, numRows, 1);
    const values = range.getValues();
    const ids = /* @__PURE__ */ new Set();
    for (const row of values) {
      const id = String((_a = row[0]) != null ? _a : "").trim();
      if (id) ids.add(id);
    }
    return ids;
  }
  function appendOffersBatch(offresSheet, rows) {
    if (!rows.length) return;
    const startRow = offresSheet.getLastRow() + 1;
    const values = rows.map((r) => [
      r.dateCreation,
      r.intituleText,
      // will be overwritten by rich text
      r.resume,
      r.entrepriseNom,
      r.contactNom,
      r.codePostal,
      r.typeContratLibelle,
      r.dureeTravailLibelle,
      r.contactEmail,
      r.contactTelephone,
      firstLine(r.entrepriseAPropos),
      r.offreId
    ]);
    const range = offresSheet.getRange(startRow, 1, rows.length, CONFIG.COLS.TOTAL);
    range.setValues(values);
    const richTexts = rows.map(
      (r) => SpreadsheetApp.newRichTextValue().setText(r.intituleText).setLinkUrl(r.intituleUrl).build()
    );
    offresSheet.getRange(startRow, CONFIG.COLS.intitule, rows.length, 1).setRichTextValues(richTexts.map((rt) => [rt]));
    const notes = rows.map((r) => [r.resumeNote]);
    offresSheet.getRange(startRow, CONFIG.COLS.resume, rows.length, 1).setNotes(notes);
    const entrepriseNotes = rows.map((r) => [r.entrepriseAProposNote]);
    offresSheet.getRange(startRow, CONFIG.COLS.entrepriseAPropos, rows.length, 1).setNotes(entrepriseNotes);
    offresSheet.setRowHeights(startRow, rows.length, CONFIG.ROW_HEIGHT_PX);
  }
  function appendImportRowsBatch(importSheet, rows) {
    if (!rows.length) return;
    const startRow = importSheet.getLastRow() + 1;
    const values = rows.map((r) => [r.offreId, r.rawJson]);
    importSheet.getRange(startRow, 1, rows.length, 2).setValues(values);
  }
  function activateSheet(ss, name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) ss.setActiveSheet(sheet);
  }

  // src/exclusions.ts
  function normalizeText(input) {
    const s = (input || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
    return s;
  }
  function parseRule(raw) {
    const r = (raw || "").trim();
    if (!r) return null;
    if (r.startsWith("/") && r.lastIndexOf("/") > 0) {
      const lastSlash = r.lastIndexOf("/");
      const pattern = r.slice(1, lastSlash);
      const flags = r.slice(lastSlash + 1);
      try {
        const regex = new RegExp(pattern, flags);
        return { raw: r, isRegex: true, regex };
      } catch (e) {
        return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
      }
    }
    return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
  }
  function loadExclusions(ss) {
    var _a, _b;
    const sheet = ss.getSheetByName(CONFIG.SHEET_EXCLUSIONS);
    if (!sheet) {
      return { intituleRules: [], entrepriseRules: [] };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { intituleRules: [], entrepriseRules: [] };
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const intituleRules = [];
    const entrepriseRules = [];
    for (const row of values) {
      const a = String((_a = row[0]) != null ? _a : "").trim();
      const b = String((_b = row[1]) != null ? _b : "").trim();
      const ra = parseRule(a);
      const rb = parseRule(b);
      if (ra) intituleRules.push(ra);
      if (rb) entrepriseRules.push(rb);
    }
    return { intituleRules, entrepriseRules };
  }
  function matchesAnyRule(text, rules) {
    if (!rules.length) return false;
    const normalized = normalizeText(text);
    for (const rule of rules) {
      if (rule.isRegex && rule.regex) {
        if (rule.regex.test(text) || rule.regex.test(normalized)) return true;
      } else if (rule.normalizedNeedle) {
        if (normalized.includes(rule.normalizedNeedle)) return true;
      }
    }
    return false;
  }
  function isExcluded(offer, exclusions) {
    const title = offer.intitule || "";
    const company = offer.entrepriseNom || "";
    if (matchesAnyRule(title, exclusions.intituleRules)) return true;
    if (matchesAnyRule(company, exclusions.entrepriseRules)) return true;
    return false;
  }

  // src/jobs.ts
  function firstLine2(text) {
    const s = (text || "").replace(/\r\n/g, "\n");
    const line = s.split("\n")[0] || "";
    return line.trim();
  }
  function toDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return /* @__PURE__ */ new Date();
    return d;
  }
  function parseHoursPerWeek(text) {
    const s = String(text || "");
    const m = s.match(/(\d{1,2}(?:[.,]\d+)?)\s*H\s*\/?\s*semaine/i);
    if (!m) return null;
    const n = Number(String(m[1]).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  function computeEtpPercent(dureeTravailLibelle) {
    const hours = parseHoursPerWeek(dureeTravailLibelle);
    if (hours == null) return "";
    const pct = Math.round(hours / 35 * 100);
    return `${pct}%`;
  }
  function ftUpdateTravailleurSocial(days) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const { offres, importSheet } = ensureSheets(ss);
    const allowUi = Boolean(SpreadsheetApp.getUi);
    const secrets = ensureSecrets(allowUi);
    const existingIds = loadExistingOfferIds(offres);
    const exclusions = loadExclusions(ss);
    const t0 = Date.now();
    const fetched = searchOffersPaged(secrets, {
      motsCles: CONFIG.SEARCH_KEYWORDS,
      publieeDepuis: days
    });
    let dedupSkipped = 0;
    let excludedSkipped = 0;
    const toInsert = [];
    const importRows = [];
    for (const o of fetched) {
      if (existingIds.has(o.id)) {
        dedupSkipped++;
        continue;
      }
      const candidate = {
        intitule: o.intitule || "",
        entrepriseNom: o.entrepriseNom || ""
      };
      if (isExcluded(candidate, exclusions)) {
        excludedSkipped++;
        continue;
      }
      const description = o.description || "";
      const resume = firstLine2(description);
      const entrepriseAPropos = o.entrepriseAPropos || "";
      toInsert.push({
        dateCreation: toDate(o.dateCreation),
        intituleText: o.intitule || "(sans intitul\xE9)",
        intituleUrl: getOfferPublicUrl(o.id),
        resume,
        resumeNote: CONFIG.RESUME_NOTE_PREFIX + description,
        entrepriseNom: o.entrepriseNom || "",
        contactNom: o.contactNom || "",
        codePostal: o.codePostal || "",
        typeContratLibelle: o.typeContratLibelle || "",
        dureeTravailLibelle: computeEtpPercent(o.dureeTravailLibelle || ""),
        contactEmail: o.contactEmail || "",
        contactTelephone: o.contactTelephone || "",
        entrepriseAPropos,
        entrepriseAProposNote: entrepriseAPropos,
        offreId: o.id
      });
      try {
        importRows.push({ offreId: o.id, rawJson: JSON.stringify(o) });
      } catch (_e) {
        importRows.push({ offreId: o.id, rawJson: String(o) });
      }
      existingIds.add(o.id);
    }
    appendOffersBatch(offres, toInsert);
    appendImportRowsBatch(importSheet, importRows);
    const ms = Date.now() - t0;
    console.log(
      `${CONFIG.LOG_PREFIX} window=${days}d fetched=${fetched.length} dedupSkipped=${dedupSkipped} excludedSkipped=${excludedSkipped} added=${toInsert.length} in ${ms}ms`
    );
  }
  function ftUpdateTravailleurSocial_24h() {
    ftUpdateTravailleurSocial(1);
  }
  function ftUpdateTravailleurSocial_7j() {
    ftUpdateTravailleurSocial(7);
  }
  function ftUpdateTravailleurSocial_31j() {
    ftUpdateTravailleurSocial(31);
  }
  function ftUpdateTravailleurSocial_30j() {
    ftUpdateTravailleurSocial_31j();
  }

  // src/main.ts
  var INIT_PROP_KEY = "FT_INIT_DONE";
  function isInitialized() {
    try {
      return PropertiesService.getScriptProperties().getProperty(INIT_PROP_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }
  function ensureDailyMidnightTrigger() {
    const handler = "ftUpdateTravailleurSocial_24h";
    const triggers = ScriptApp.getProjectTriggers();
    const exists = triggers.some(
      (t) => t.getHandlerFunction && t.getHandlerFunction() === handler && t.getEventType && t.getEventType() === ScriptApp.EventType.CLOCK
    );
    if (!exists) {
      ScriptApp.newTrigger(handler).timeBased().atHour(0).everyDays(1).create();
    }
  }
  function hasDailyMidnightTrigger() {
    const handler = "ftUpdateTravailleurSocial_24h";
    try {
      const triggers = ScriptApp.getProjectTriggers();
      return triggers.some(
        (t) => t.getHandlerFunction && t.getHandlerFunction() === handler && t.getEventType && t.getEventType() === ScriptApp.EventType.CLOCK
      );
    } catch (_e) {
      return false;
    }
  }
  function canUseTriggers() {
    try {
      ScriptApp.getProjectTriggers();
      return true;
    } catch (_e) {
      return false;
    }
  }
  function canUseProperties() {
    try {
      PropertiesService.getScriptProperties().getKeys();
      return true;
    } catch (_e) {
      return false;
    }
  }
  function canUseCache() {
    try {
      const c = CacheService.getScriptCache();
      c.put("FT_HEALTHCHECK", "1", 10);
      c.remove("FT_HEALTHCHECK");
      return true;
    } catch (_e) {
      return false;
    }
  }
  function ftHealthCheckSilent() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const issues = [];
    try {
      ss.getId();
    } catch (_e) {
      issues.push("Acc\xE8s au Spreadsheet: non autoris\xE9.");
    }
    if (!canUseProperties())
      issues.push("Propri\xE9t\xE9s du script (Script Properties): non autoris\xE9.");
    if (!canUseCache()) issues.push("CacheService: non autoris\xE9.");
    try {
      if (!getSecrets()) issues.push("Secrets manquants (FT_CLIENT_ID / FT_CLIENT_SECRET).");
    } catch (_e) {
      issues.push("Lecture des secrets: impossible (droits Script Properties).");
    }
    if (!canUseTriggers()) {
      issues.push("Triggers (d\xE9clencheurs): non autoris\xE9.");
    } else if (!hasDailyMidnightTrigger()) {
      issues.push("D\xE9clencheur quotidien (00h) absent. Lancez France Travail \xBB Initialiser.");
    }
    try {
      if (issues.length) {
        ss.toast(
          `Health check: ${issues.length} point(s) \xE0 corriger.
` + issues.slice(0, 3).join("\n"),
          "France Travail",
          20
        );
      }
    } catch (_e) {
    }
    if (issues.length) {
      console.warn(`${CONFIG.LOG_PREFIX} Health check issues:
- ${issues.join("\n- ")}`);
    } else {
      console.log(`${CONFIG.LOG_PREFIX} Health check OK`);
    }
  }
  function ftHealthCheck() {
    const ui = SpreadsheetApp.getUi();
    const issues = [];
    if (!canUseProperties()) issues.push("Propri\xE9t\xE9s du script: NON");
    if (!canUseCache()) issues.push("CacheService: NON");
    if (!canUseTriggers()) issues.push("Triggers: NON");
    const secretsOk = (() => {
      try {
        return Boolean(getSecrets());
      } catch (_e) {
        return false;
      }
    })();
    if (!secretsOk) issues.push("Secrets FT_CLIENT_ID / FT_CLIENT_SECRET: manquants ou illisibles");
    const triggerOk = canUseTriggers() ? hasDailyMidnightTrigger() : false;
    if (!triggerOk) issues.push("D\xE9clencheur quotidien 00h: absent");
    const title = "France Travail \xBB Health check";
    if (!issues.length) {
      ui.alert(
        title,
        "Tout est OK.\n\nSecrets pr\xE9sents, droits valides, d\xE9clencheur quotidien en place.",
        ui.ButtonSet.OK
      );
      return;
    }
    const msg = "Points \xE0 corriger :\n\n- " + issues.join("\n- ") + "\n\nActions :\n\xBB France Travail > Initialiser (cr\xE9e le d\xE9clencheur)\n\xBB France Travail > Configurer les secrets";
    ui.alert(title, msg, ui.ButtonSet.OK);
  }
  function ftInit() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets(ss);
    if (!getSecrets()) {
      promptAndStoreSecrets();
    }
    ensureDailyMidnightTrigger();
    PropertiesService.getScriptProperties().setProperty(INIT_PROP_KEY, "1");
    ui.alert(
      "France Travail",
      "Initialisation OK.\n\nLe d\xE9clencheur quotidien (00h) est en place.",
      ui.ButtonSet.OK
    );
  }
  function onOpen() {
    try {
      PropertiesService.getScriptProperties().setProperty(
        "FT_DEBUG_LAST_ONOPEN",
        (/* @__PURE__ */ new Date()).toISOString()
      );
    } catch (e) {
    }
    console.log(`${CONFIG.LOG_PREFIX} onOpen fired at ${(/* @__PURE__ */ new Date()).toISOString()}`);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets(ss);
    buildMenu();
    try {
      ftHealthCheckSilent();
    } catch (_e) {
    }
    try {
      if (!isInitialized()) {
        ss.toast(
          "Premi\xE8re utilisation : autorisez le script.\nMenu France Travail \xBB Initialiser / Autoriser",
          "France Travail",
          20
        );
      }
    } catch (_e) {
    }
    try {
      if (!getSecrets()) {
        ss.toast(
          "Secrets France Travail manquants.\nMenu France Travail \xBB Configurer les secrets.",
          "France Travail",
          20
        );
        ftShowSecretsMissing();
      }
    } catch (e) {
    }
  }
  function buildMenu() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu("France Travail").addItem("Initialiser", "ftInit").addItem("Health check", "ftHealthCheck").addSeparator().addItem("Mettre \xE0 jour (24h)", "ftUpdateTravailleurSocial_24h").addItem("Mettre \xE0 jour (7j)", "ftUpdateTravailleurSocial_7j").addItem("Mettre \xE0 jour (31j)", "ftUpdateTravailleurSocial_31j").addSeparator().addItem("Configurer les secrets", "ftConfigureSecrets").addItem("Ouvrir l\u2019onglet Exclusions", "ftOpenExclusions").addSeparator().addItem("Aide / README", "ftHelp").addToUi();
  }
  function ftShowSecretsMissing() {
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
  function ftConfigureSecrets() {
    promptAndStoreSecrets();
    SpreadsheetApp.getUi().alert("Secrets enregistr\xE9s dans Script Properties.");
  }
  function ftOpenExclusions() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets(ss);
    activateSheet(ss, CONFIG.SHEET_EXCLUSIONS);
  }
  function ftHelp() {
    const msg = `Outil France Travail (Offres v2)

\u2022 Menu > France Travail > Mettre \xE0 jour (24h) : importe les offres publi\xE9es depuis 1 jour pour la recherche "travailleur social".
\u2022 D\xE9duplication : bas\xE9e sur l'ID offre stock\xE9 en colonne masqu\xE9e (offre_id).
\u2022 Exclusions : onglet Exclusions (col A = r\xE8gles intitul\xE9, col B = r\xE8gles entreprise).
  - Texte simple = match 'contains' apr\xE8s normalisation (minuscule, sans accents).
  - Regex = /pattern/flags.

Secrets
\u2022 FT_CLIENT_ID / FT_CLIENT_SECRET sont stock\xE9s dans Script Properties.
\u2022 Le token OAuth est mis en cache ~50 minutes.
`;
    SpreadsheetApp.getUi().alert(msg);
  }
  function ftDebugPing() {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    PropertiesService.getScriptProperties().setProperty("FT_DEBUG_PING", ts);
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheets()[0];
    sheet.getRange("A1").setValue(`FT_DEBUG_PING ${ts}`);
    console.log(`${CONFIG.LOG_PREFIX} ftDebugPing ${ts}`);
  }
  var G = (function() {
    return Function("return this")();
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
