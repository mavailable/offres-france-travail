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
    "Exclure si entreprise contient / match",
    "Exclure si description contient / match",
    "Exclure si RAW API contient / match",
    "Exclure si contrat contient / match"
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
    props.setProperties({
      [CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
      [CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim()
    });
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
    sheet.getRange(1, 1, 1, HEADERS_EXCLUSIONS.length).setValues([HEADERS_EXCLUSIONS]);
    sheet.setFrozenRows(1);
    for (let i = 1; i <= HEADERS_EXCLUSIONS.length; i++) {
      sheet.setColumnWidth(i, 320);
    }
    sheet.getRange(1, 1, 1, HEADERS_EXCLUSIONS.length).setFontWeight("bold").setBackground("#f1f3f4");
  }
  function ensureExclusionsHeaders(sheet) {
    const expected = HEADERS_EXCLUSIONS;
    const headerRange = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, expected.length);
    const current = headerRange.getValues()[0].map(String);
    const same = current.length === expected.length && expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same) {
      headerRange.setValues([expected]);
    }
    sheet.setFrozenRows(1);
    for (let i = 1; i <= expected.length; i++) {
      sheet.setColumnWidth(i, 320);
    }
    headerRange.setFontWeight("bold").setBackground("#f1f3f4");
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
    var _a, _b, _c, _d, _e;
    const sheet = ss.getSheetByName(CONFIG.SHEET_EXCLUSIONS);
    if (!sheet) {
      return {
        intituleRules: [],
        entrepriseRules: [],
        descriptionRules: [],
        rawRules: [],
        contratRules: []
      };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2)
      return {
        intituleRules: [],
        entrepriseRules: [],
        descriptionRules: [],
        rawRules: [],
        contratRules: []
      };
    const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const intituleRules = [];
    const entrepriseRules = [];
    const descriptionRules = [];
    const rawRules = [];
    const contratRules = [];
    for (const row of values) {
      const a = String((_a = row[0]) != null ? _a : "").trim();
      const b = String((_b = row[1]) != null ? _b : "").trim();
      const c = String((_c = row[2]) != null ? _c : "").trim();
      const d = String((_d = row[3]) != null ? _d : "").trim();
      const e = String((_e = row[4]) != null ? _e : "").trim();
      const ra = parseRule(a);
      const rb = parseRule(b);
      const rc = parseRule(c);
      const rd = parseRule(d);
      const re = parseRule(e);
      if (ra) intituleRules.push(ra);
      if (rb) entrepriseRules.push(rb);
      if (rc) descriptionRules.push(rc);
      if (rd) rawRules.push(rd);
      if (re) contratRules.push(re);
    }
    return { intituleRules, entrepriseRules, descriptionRules, rawRules, contratRules };
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
    const description = offer.description || "";
    const raw = offer.raw || "";
    const contrat = offer.typeContratLibelle || "";
    if (matchesAnyRule(title, exclusions.intituleRules)) return true;
    if (matchesAnyRule(company, exclusions.entrepriseRules)) return true;
    if (matchesAnyRule(description, exclusions.descriptionRules)) return true;
    if (matchesAnyRule(raw, exclusions.rawRules)) return true;
    if (matchesAnyRule(contrat, exclusions.contratRules)) return true;
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
        entrepriseNom: o.entrepriseNom || "",
        description: o.description || "",
        typeContratLibelle: o.typeContratLibelle || "",
        // Raw payload is used only for filtering; catch stringify issues.
        raw: (() => {
          try {
            return JSON.stringify(o);
          } catch (_e) {
            return String(o);
          }
        })()
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

  // src/aiConfig.ts
  var AI_CONFIG_KEYS = {
    OPENAI_API_KEY: "OPENAI_API_KEY",
    OPENAI_MODEL: "OPENAI_MODEL",
    TEMPERATURE: "OPENAI_TEMPERATURE",
    MAX_OUTPUT_TOKENS: "OPENAI_MAX_OUTPUT_TOKENS",
    REQUEST_TIMEOUT_MS: "OPENAI_REQUEST_TIMEOUT_MS",
    RATE_LIMIT_MS: "OPENAI_RATE_LIMIT_MS",
    DRY_RUN: "OPENAI_DRY_RUN",
    LOG_PAYLOADS: "OPENAI_LOG_PAYLOADS"
  };
  var DEFAULTS = {
    model: "gpt-5.2",
    temperature: 0.2,
    maxOutputTokens: 400,
    requestTimeoutMs: 9e4,
    rateLimitMs: 800,
    dryRun: false,
    logPayloads: true
  };
  function getProps() {
    return PropertiesService.getScriptProperties();
  }
  function toBool(v, fallback) {
    if (v == null || v === "") return fallback;
    return /^(1|true|yes|y|on)$/i.test(String(v).trim());
  }
  function toNumber(v, fallback) {
    if (v == null || v === "") return fallback;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : fallback;
  }
  function getAiConfig() {
    const p = getProps();
    const apiKey = (p.getProperty(AI_CONFIG_KEYS.OPENAI_API_KEY) || "").trim();
    const model = (p.getProperty(AI_CONFIG_KEYS.OPENAI_MODEL) || DEFAULTS.model).trim() || DEFAULTS.model;
    const temperature = toNumber(p.getProperty(AI_CONFIG_KEYS.TEMPERATURE), DEFAULTS.temperature);
    const maxOutputTokens = Math.max(16, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.MAX_OUTPUT_TOKENS), DEFAULTS.maxOutputTokens)));
    const requestTimeoutMs = Math.max(5e3, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.REQUEST_TIMEOUT_MS), DEFAULTS.requestTimeoutMs)));
    const rateLimitMs = Math.max(0, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.RATE_LIMIT_MS), DEFAULTS.rateLimitMs)));
    const dryRun = toBool(p.getProperty(AI_CONFIG_KEYS.DRY_RUN), DEFAULTS.dryRun);
    const logPayloads = toBool(p.getProperty(AI_CONFIG_KEYS.LOG_PAYLOADS), DEFAULTS.logPayloads);
    return {
      apiKey,
      model,
      temperature,
      maxOutputTokens,
      requestTimeoutMs,
      rateLimitMs,
      dryRun,
      logPayloads
    };
  }
  function hasAiApiKey() {
    try {
      return Boolean(getAiConfig().apiKey);
    } catch (_e) {
      return false;
    }
  }
  function promptAndStoreAiConfig() {
    const ui = SpreadsheetApp.getUi();
    const title = "Configuration Agents IA";
    const rKey = ui.prompt(
      title,
      "Saisir OPENAI_API_KEY :",
      ui.ButtonSet.OK_CANCEL
    );
    if (rKey.getSelectedButton() !== ui.Button.OK) {
      throw new Error("Configuration annul\xE9e (OPENAI_API_KEY manquante).");
    }
    const apiKey = (rKey.getResponseText() || "").trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY est vide.");
    const rModel = ui.prompt(
      title,
      `Mod\xE8le OpenAI (d\xE9faut: ${DEFAULTS.model}) :`,
      ui.ButtonSet.OK_CANCEL
    );
    if (rModel.getSelectedButton() !== ui.Button.OK) {
      throw new Error("Configuration annul\xE9e (mod\xE8le non confirm\xE9).");
    }
    const model = (rModel.getResponseText() || "").trim() || DEFAULTS.model;
    const props = getProps();
    props.setProperties({
      [AI_CONFIG_KEYS.OPENAI_API_KEY]: apiKey,
      [AI_CONFIG_KEYS.OPENAI_MODEL]: model,
      [AI_CONFIG_KEYS.TEMPERATURE]: String(DEFAULTS.temperature),
      [AI_CONFIG_KEYS.MAX_OUTPUT_TOKENS]: String(DEFAULTS.maxOutputTokens),
      [AI_CONFIG_KEYS.REQUEST_TIMEOUT_MS]: String(DEFAULTS.requestTimeoutMs),
      [AI_CONFIG_KEYS.RATE_LIMIT_MS]: String(DEFAULTS.rateLimitMs),
      [AI_CONFIG_KEYS.DRY_RUN]: String(DEFAULTS.dryRun),
      [AI_CONFIG_KEYS.LOG_PAYLOADS]: String(DEFAULTS.logPayloads)
    });
    return getAiConfig();
  }

  // src/aiSheets.ts
  var AI_SHEETS = {
    JOBS: "Jobs",
    LOGS: "Logs"
  };
  var HEADERS_JOBS = [
    "job_key",
    "enabled",
    "prompt_template",
    "output_mode",
    "schema_json",
    "target_columns",
    "write_strategy",
    "rate_limit_ms"
  ];
  var HEADERS_LOGS = [
    "timestamp",
    "job_key",
    "offre_id",
    "row_number",
    "request_id",
    "model",
    "prompt_rendered",
    "response_text",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "duration_ms",
    "status",
    "error_message"
  ];
  function ensureAiSheets(ss) {
    let jobs = ss.getSheetByName(AI_SHEETS.JOBS);
    const jobsWasCreated = !jobs;
    if (!jobs) {
      jobs = ss.insertSheet(AI_SHEETS.JOBS);
      jobs.getRange(1, 1, 1, HEADERS_JOBS.length).setValues([Array.from(HEADERS_JOBS)]);
      jobs.setFrozenRows(1);
      jobs.getRange(1, 1, 1, HEADERS_JOBS.length).setFontWeight("bold").setBackground("#f1f3f4");
      jobs.setColumnWidth(1, 140);
      jobs.setColumnWidth(2, 90);
      jobs.setColumnWidth(3, 700);
    }
    try {
      const lastRow = jobs.getLastRow();
      if (jobsWasCreated || lastRow < 2) {
        const completionPrompt = [
          "Tu es un assistant qui structure des offres d'emploi.",
          "Retourne STRICTEMENT un JSON (sans texte autour) avec les cl\xE9s suivantes : Entreprise, Contact, Email, T\xE9l\xE9phone, \xC0 propos, R\xE9sum\xE9, ETP.",
          "Entreprise doit \xEAtre le nom de l'entreprise (string).",
          'ETP doit \xEAtre un pourcentage sous forme de texte, ex: "100%", "80%". Si inconnue, cha\xEEne vide.',
          "Si une info est absente, mets une cha\xEEne vide.",
          "\nDonn\xE9es brutes (JSON FT):",
          "{{Import.raw_json}}"
        ].join("\n");
        const scorePrompt = [
          "Donne un score entre 0 et 100 (nombre uniquement) selon la qualit\xE9/pertinence de l'offre.",
          "Ne retourne rien d'autre que le nombre.",
          "\nContexte:",
          "Poste: {{Offres.Poste}}",
          "Entreprise: {{Offres.Entreprise}}",
          "R\xE9sum\xE9: {{Offres.R\xE9sum\xE9}}",
          "Brut: {{Import.raw_json}}"
        ].join("\n");
        const commercialScorePrompt = [
          "Tu es un moteur de scoring commercial pour proposer un travailleur social ind\xE9pendant.",
          "",
          "\xC0 partir du JSON brut de l\u2019offre ci-dessous, calcule un score final born\xE9 entre 0 et 100.",
          "Le score mesure la pertinence commerciale (probabilit\xE9 de vendre une prestation d\u2019ind\xE9pendant), pas l\u2019int\xE9r\xEAt du poste pour un candidat.",
          "",
          "Bar\xE8me (appliquer dans cet ordre) :",
          "",
          "1) Temps partiel \u2014 0 \xE0 40 pts",
          "- \u226420%: 40",
          "- 21\u201330%: 32",
          "- 31\u201340%: 24",
          "- 41\u201350%: 16",
          "- non pr\xE9cis\xE9: 10",
          "- >50%: 0",
          "",
          "2) Besoin difficile / morcel\xE9 \u2014 0 \xE0 30 pts",
          "(remplacement, urgence, compl\xE9ment, CDD court, difficult\xE9)",
          "Attribuer 0 / 15 / 30 selon intensit\xE9 d\xE9tect\xE9e dans l\u2019annonce.",
          "",
          "3) Type de structure \u2014 0 \xE0 20 pts",
          "- Institution: 0\u20135",
          "- \xC9tablissement local: 6\u201314",
          "- Petite asso / structure isol\xE9e: 15\u201320",
          "",
          "4) Contact exploitable \u2014 0 \xE0 10 pts",
          "- Email direct: 10",
          "- Email g\xE9n\xE9rique: 5",
          "- Aucun: 0",
          "",
          "Malus obligatoire",
          "Si l\u2019annonce est \xE9mise par un cabinet de recrutement / int\xE9rim / interm\xE9diaire \u2192 -40 pts.",
          "",
          "Consignes d\u2019extraction :",
          "- Utilise les champs pertinents du JSON (ex: description, entreprise/nom, type d\u2019employeur, contact, etc.).",
          "- D\xE9duis le % temps partiel \xE0 partir d\u2019indices comme \u201CXXH/semaine\u201D, \u201Ctemps partiel\u201D, \u201CETP\u201D, \u201Cmi-temps\u201D, etc.",
          "- Pour \u201Ckeywords\u201D, retourne des mots/expressions COURTES r\xE9ellement pr\xE9sentes (ou quasi mot pour mot) dans l\u2019annonce.",
          "- Si tu ne trouves pas d\u2019\xE9l\xE9ment probant pour un crit\xE8re, applique la valeur \u201Cnon pr\xE9cis\xE9\u201D ou une intensit\xE9 faible.",
          "",
          "Sortie :",
          "Retourne UNIQUEMENT un JSON valide exactement au format suivant (aucun texte autour) :",
          "",
          "{",
          '  "score": 0,',
          '  "keywords_positive": ["..."],',
          '  "keywords_negative": ["..."],',
          '  "explanation": "..."',
          "}",
          "",
          "Contraintes :",
          '- "score" doit \xEAtre un entier.',
          '- "keywords_positive" et "keywords_negative": 3 \xE0 8 \xE9l\xE9ments chacun (moins si vraiment impossible).',
          '- "explanation": UNE seule phrase, courte, qui r\xE9sume les facteurs principaux (incluant le malus si appliqu\xE9).',
          "",
          "OFFRE (JSON brut) :",
          "{{Import.raw_json}}"
        ].join("\n");
        const keywordsPrompt = [
          "You are a keyword extraction engine.",
          "",
          "Your task is to extract NEGATIVE COMMERCIAL KEYWORDS only,",
          "indicating that a job offer is NOT suitable for placing",
          'independent social workers ("as a service").',
          "",
          "You MUST extract keywords ONLY from the following fields:",
          "- intitule",
          "- description",
          "- entrepriseNom",
          "- entrepriseAPropos",
          "",
          "Do NOT use any other fields.",
          "Do NOT infer or invent information.",
          "Do NOT rephrase freely.",
          "",
          "Rules:",
          "- Keywords must be short (1 to 4 words).",
          "- Keywords must appear explicitly or almost verbatim in the text.",
          "- No interpretation, no synonyms, no paraphrasing.",
          "- If no strong negative keyword is found, return an empty array.",
          "",
          "Negative signals include (examples, not to be added unless present):",
          "- CDI / permanent full-time roles",
          "- Large or national institutions",
          "- Recruitment agencies or intermediaries",
          "- Strong hierarchy or rigid frameworks",
          "- Exclusive employment wording",
          "",
          "Output:",
          "Return ONLY a valid JSON exactly in the following format:",
          "",
          "{",
          '  "keywords_negative": {',
          '    "intitule": ["..."],',
          '    "description": ["..."],',
          '    "entrepriseNom": ["..."],',
          '    "entrepriseAPropos": ["..."]',
          "  }",
          "}",
          "",
          "Constraints:",
          "- Each array may contain 0 to 5 elements.",
          "- Do not duplicate the same keyword across multiple fields.",
          "- If a field is missing or empty, return an empty array for that field.",
          "- Return valid JSON only. No additional text.",
          "",
          "JOB OFFER (raw JSON):",
          "{{Import.raw_json}}"
        ].join("\n");
        const rows = [
          [
            "completion",
            "TRUE",
            completionPrompt,
            "json",
            "",
            "Entreprise,Contact,Email,T\xE9l\xE9phone,\xC0 propos,R\xE9sum\xE9,ETP",
            "fill_if_empty",
            ""
          ],
          [
            "score",
            "TRUE",
            scorePrompt,
            "number",
            "",
            "Score",
            "overwrite",
            ""
          ],
          [
            "commercial_score",
            "TRUE",
            commercialScorePrompt,
            "json",
            "",
            "Score commercial,Keywords +,Keywords -,Explication",
            "overwrite",
            ""
          ],
          [
            "keywords",
            "TRUE",
            keywordsPrompt,
            "json",
            "",
            "Keywords - Intitule,Keywords - Description,Keywords - EntrepriseNom,Keywords - EntrepriseAPropos",
            "overwrite",
            ""
          ]
        ];
        jobs.getRange(2, 1, rows.length, HEADERS_JOBS.length).setValues(rows);
        jobs.setRowHeights(2, rows.length, 60);
        jobs.getRange(2, 2, rows.length, 1).insertCheckboxes();
        jobs.getRange(2, 3, rows.length, 1).setWrap(true);
      }
    } catch (_e) {
    }
    let logs = ss.getSheetByName(AI_SHEETS.LOGS);
    if (!logs) {
      logs = ss.insertSheet(AI_SHEETS.LOGS);
      logs.getRange(1, 1, 1, HEADERS_LOGS.length).setValues([Array.from(HEADERS_LOGS)]);
      logs.setFrozenRows(1);
      logs.getRange(1, 1, 1, HEADERS_LOGS.length).setFontWeight("bold").setBackground("#f1f3f4");
      logs.setColumnWidth(1, 170);
      logs.setColumnWidth(2, 120);
      logs.setColumnWidth(3, 140);
      logs.setColumnWidth(7, 500);
      logs.setColumnWidth(8, 500);
    }
    return { jobs, logs };
  }
  function activateAiSheet(ss, name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) ss.setActiveSheet(sheet);
  }

  // src/aiTemplating.ts
  function renderTemplate(template, vars) {
    const t = String(template || "");
    return t.replace(/\{\{\s*([\w.\-À-ÿ]+)\s*\}\}/g, (_m, key) => {
      var _a;
      const k = String(key || "").trim();
      return (_a = vars[k]) != null ? _a : "";
    });
  }

  // src/aiLogs.ts
  function uuid() {
    try {
      return Utilities.getUuid();
    } catch (_e) {
      return String(Date.now()) + "-" + String(Math.random()).slice(2);
    }
  }
  function newRequestId() {
    return uuid();
  }
  function truncate(s, max) {
    const text = String(s || "");
    if (text.length <= max) return text;
    return text.slice(0, max) + "\n\u2026(truncated)";
  }
  function appendAiLog(ss, row, opts) {
    var _a, _b, _c;
    const { logs } = ensureAiSheets(ss);
    const logPayloads = (opts == null ? void 0 : opts.logPayloads) !== false;
    const prompt = logPayloads ? truncate(row.promptRendered, 45e3) : "(hidden)";
    const resp = logPayloads ? truncate(row.responseText, 45e3) : "(hidden)";
    const values = [
      row.timestamp,
      row.jobKey,
      row.offreId,
      row.rowNumber,
      row.requestId,
      row.model,
      prompt,
      resp,
      (_a = row.inputTokens) != null ? _a : "",
      (_b = row.outputTokens) != null ? _b : "",
      (_c = row.totalTokens) != null ? _c : "",
      row.durationMs,
      row.status,
      row.errorMessage || ""
    ];
    logs.appendRow(values);
    try {
      const s = ss.getSheetByName(AI_SHEETS.LOGS);
      if (s && s.isSheetHidden()) s.showSheet();
    } catch (_e) {
    }
  }

  // src/openai.ts
  function sleepMs(ms) {
    if (ms > 0) Utilities.sleep(ms);
  }
  function isRetryableHttp(code) {
    return code === 408 || code === 429 || code >= 500 && code <= 599;
  }
  function jitter(ms) {
    const r = 0.8 + Math.random() * 0.4;
    return Math.floor(ms * r);
  }
  function doFetch(cfg, payload) {
    var _a;
    const url = "https://api.openai.com/v1/responses";
    const options = {
      method: "post",
      muteHttpExceptions: true,
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`
      },
      // Apps Script supports `deadline` in seconds.
      deadline: Math.max(5, Math.floor(Math.max(5e3, cfg.requestTimeoutMs) / 1e3))
    };
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const raw = res.getContentText() || "";
    if (code < 200 || code >= 300) {
      const err = new Error(`OpenAI HTTP ${code}: ${raw ? raw.slice(0, 800) : "(empty)"}`);
      err.httpStatus = code;
      err.httpBody = raw;
      throw err;
    }
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch (_e) {
      json = null;
    }
    if (!json) throw new Error("OpenAI: r\xE9ponse JSON invalide");
    const text = (_a = json.output_text) != null ? _a : Array.isArray(json.output) ? json.output.flatMap((o) => Array.isArray(o.content) ? o.content : []).map((c) => c.text).filter(Boolean).join("\n") : "";
    const usage = json.usage || {};
    return {
      text: String(text || ""),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens
    };
  }
  function doFetchWithRetry(cfg, payload) {
    const maxAttempts = 3;
    const baseBackoffMs = 600;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return doFetch(cfg, payload);
      } catch (e) {
        lastErr = e;
        const httpStatus = Number(e == null ? void 0 : e.httpStatus);
        const msg = String((e == null ? void 0 : e.message) || e);
        const looksLikeTimeout = /timed out|timeout|exceeded maximum execution time/i.test(msg);
        const retryable = Number.isFinite(httpStatus) && isRetryableHttp(httpStatus) || looksLikeTimeout;
        if (!retryable || attempt === maxAttempts) throw e;
        const backoff = jitter(baseBackoffMs * Math.pow(2, attempt - 1));
        sleepMs(backoff);
      }
    }
    throw lastErr != null ? lastErr : new Error("OpenAI: \xE9chec inconnu");
  }
  function callOpenAiText(cfg, prompt, opts) {
    var _a;
    const rate = Math.max(0, (_a = opts == null ? void 0 : opts.rateLimitMsOverride) != null ? _a : cfg.rateLimitMs);
    sleepMs(rate);
    const basePayload = {
      model: cfg.model,
      input: prompt,
      temperature: cfg.temperature,
      max_output_tokens: cfg.maxOutputTokens
    };
    if (opts == null ? void 0 : opts.useWebSearch) {
      const payloadWithSearch = { ...basePayload, tools: [{ type: "web_search_preview" }] };
      try {
        const r2 = doFetchWithRetry(cfg, payloadWithSearch);
        return { ...r2, usedWebSearch: true, webSearchFallback: false };
      } catch (e) {
        const msg = String((e == null ? void 0 : e.message) || e);
        const looksLikeToolIssue = /tool|web_search|unsupported|not allowed|not authorized|invalid/i.test(msg);
        if (looksLikeToolIssue) {
          const r2 = doFetchWithRetry(cfg, basePayload);
          return { ...r2, usedWebSearch: true, webSearchFallback: true };
        }
        throw e;
      }
    }
    const r = doFetchWithRetry(cfg, basePayload);
    return { ...r, usedWebSearch: false, webSearchFallback: false };
  }
  function getLastCallDurationMs() {
    return 0;
  }

  // src/aiCache.ts
  var CACHE_PREFIX = "ai:prompt:";
  function sha256Hex(s) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      s,
      Utilities.Charset.UTF_8
    );
    return bytes.map((b) => {
      const x = (b < 0 ? b + 256 : b).toString(16);
      return x.length === 1 ? "0" + x : x;
    }).join("");
  }
  function getCache() {
    return CacheService.getScriptCache();
  }
  function buildPromptCacheKey(parts) {
    const src = JSON.stringify({
      v: 1,
      model: parts.model,
      temperature: parts.temperature,
      maxOutputTokens: parts.maxOutputTokens,
      outputMode: parts.outputMode,
      schemaJson: parts.schemaJson || "",
      prompt: parts.prompt
    });
    return CACHE_PREFIX + sha256Hex(src);
  }
  function getCachedPromptResult(key) {
    try {
      const raw = getCache().get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }
  function setCachedPromptResult(key, value) {
    var _a, _b;
    try {
      const ttlSeconds = (_b = (_a = CONFIG) == null ? void 0 : _a.AI_CACHE_TTL_SECONDS) != null ? _b : 6 * 60 * 60;
      getCache().put(key, JSON.stringify(value), ttlSeconds);
    } catch (_e) {
    }
  }

  // src/aiRunner.ts
  function parseCsvList(s) {
    return String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  }
  function loadJobsConfig(ss) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { jobs } = ensureAiSheets(ss);
    const lastRow = jobs.getLastRow();
    const map = /* @__PURE__ */ new Map();
    if (lastRow < 2) return map;
    const values = jobs.getRange(2, 1, lastRow - 1, 8).getValues();
    for (const r of values) {
      const jobKey = String((_a = r[0]) != null ? _a : "").trim();
      if (!jobKey) continue;
      const enabled = /^(true|1|yes|y)$/i.test(String((_b = r[1]) != null ? _b : "").trim());
      const promptTemplate = String((_c = r[2]) != null ? _c : "");
      const outputMode = String((_d = r[3]) != null ? _d : "text").trim() || "text";
      const schemaJson = String((_e = r[4]) != null ? _e : "").trim() || void 0;
      const targetColumns = parseCsvList(String((_f = r[5]) != null ? _f : ""));
      const writeStrategy = String((_g = r[6]) != null ? _g : "fill_if_empty").trim() || "fill_if_empty";
      const rateLimitMsRaw = String((_h = r[7]) != null ? _h : "").trim();
      const rateLimitMs = rateLimitMsRaw ? Number(rateLimitMsRaw) : void 0;
      map.set(jobKey, {
        jobKey,
        enabled,
        promptTemplate,
        outputMode,
        schemaJson,
        targetColumns,
        writeStrategy,
        rateLimitMs: Number.isFinite(rateLimitMs) ? rateLimitMs : void 0
      });
    }
    return map;
  }
  function ensureOffresColumns(offres, columns) {
    const header = offres.getRange(1, 1, 1, offres.getLastColumn()).getValues()[0].map(String);
    const existing = new Set(header.map((h) => (h || "").trim()).filter(Boolean));
    const missing = columns.filter((c) => !existing.has(c));
    if (!missing.length) return;
    const startCol = header.length + 1;
    offres.getRange(1, startCol, 1, missing.length).setValues([missing]);
    offres.getRange(1, startCol, 1, missing.length).setFontWeight("bold").setBackground("#f1f3f4");
  }
  function getHeaderIndexMap(offres) {
    const header = offres.getRange(1, 1, 1, offres.getLastColumn()).getValues()[0].map(String);
    const map = /* @__PURE__ */ new Map();
    header.forEach((h, i) => {
      const key = (h || "").trim();
      if (key) map.set(key, i);
    });
    return map;
  }
  function extractJsonObject(text) {
    const s = String(text || "").trim();
    if (!s) throw new Error("R\xE9ponse vide");
    try {
      return JSON.parse(s);
    } catch (_e) {
    }
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sub = s.slice(start, end + 1);
      return JSON.parse(sub);
    }
    throw new Error("JSON introuvable dans la r\xE9ponse");
  }
  function parseNumberStrict(text) {
    const s = String(text || "").trim();
    if (!s) throw new Error("Nombre vide");
    const m = s.match(/-?\d+(?:[.,]\d+)?/);
    if (!m) throw new Error(`Nombre introuvable: ${s.slice(0, 80)}`);
    const n = Number(m[0].replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`Nombre invalide: ${m[0]}`);
    return n;
  }
  function runJob(jobKey) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cfg = getAiConfig();
    if (!cfg.apiKey) {
      SpreadsheetApp.getUi().alert(
        "Agents IA",
        "OPENAI_API_KEY manquante. Utilisez le menu Agents > Configurer (OpenAI).",
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }
    const jobs = loadJobsConfig(ss);
    const job = jobs.get(jobKey);
    if (!job) {
      SpreadsheetApp.getUi().alert("Agents IA", `Job introuvable: ${jobKey}`, SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }
    const { offres, importSheet } = (function() {
      const _ss = ss;
      const sheetOffres = _ss.getSheetByName(CONFIG.SHEET_OFFRES);
      const sheetImport = _ss.getSheetByName(CONFIG.SHEET_IMPORT);
      if (!sheetOffres || !sheetImport) throw new Error("Onglets Offres/Import manquants. Lancez France Travail > Initialiser.");
      return { offres: sheetOffres, importSheet: sheetImport };
    })();
    const importLastRow = importSheet.getLastRow();
    const importMap = /* @__PURE__ */ new Map();
    if (importLastRow >= 2) {
      const rows = importSheet.getRange(2, 1, importLastRow - 1, 2).getValues();
      for (const r of rows) {
        const id = String((_a = r[0]) != null ? _a : "").trim();
        const raw = String((_b = r[1]) != null ? _b : "");
        if (id) importMap.set(id, raw);
      }
    }
    ensureOffresColumns(offres, job.targetColumns);
    const headerMap = getHeaderIndexMap(offres);
    const lastRow = offres.getLastRow();
    if (lastRow < 2) return;
    const table = offres.getRange(1, 1, lastRow, offres.getLastColumn()).getValues();
    const header = table[0].map(String);
    const idxOffreId = (_c = headerMap.get("offre_ID")) != null ? _c : headerMap.get("offre_id");
    if (idxOffreId == null) throw new Error("Colonne offre_ID introuvable dans Offres");
    const writes = [];
    const highlightWrites = [];
    for (let i = 1; i < table.length; i++) {
      const rowNumber = i + 1;
      const row = table[i];
      const offreId = String((_d = row[idxOffreId]) != null ? _d : "").trim();
      if (!offreId) continue;
      if (job.writeStrategy === "fill_if_empty") {
        let allFilled = true;
        for (const target of job.targetColumns) {
          const colIdx0 = headerMap.get(target);
          if (colIdx0 == null) continue;
          const current = row[colIdx0];
          const isEmpty = current == null || String(current).trim() === "";
          if (isEmpty) {
            allFilled = false;
            break;
          }
        }
        if (allFilled) {
          appendAiLog(
            ss,
            {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              jobKey: job.jobKey,
              offreId,
              rowNumber,
              requestId: newRequestId(),
              model: cfg.model,
              promptRendered: "",
              responseText: "",
              durationMs: 0,
              status: "SKIP",
              errorMessage: "FILL_IF_EMPTY: already filled"
            },
            { logPayloads: cfg.logPayloads }
          );
          continue;
        }
      }
      const vars = {};
      for (let c = 0; c < header.length; c++) {
        const colName = String((_e = header[c]) != null ? _e : "").trim();
        if (!colName) continue;
        vars[`Offres.${colName}`] = String((_f = row[c]) != null ? _f : "");
      }
      vars["Import.raw_json"] = (_g = importMap.get(offreId)) != null ? _g : "";
      const prompt = renderTemplate(job.promptTemplate, vars);
      const cacheKey = buildPromptCacheKey({
        model: cfg.model,
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxOutputTokens,
        outputMode: job.outputMode,
        schemaJson: job.schemaJson,
        prompt
      });
      const requestId = newRequestId();
      const started = Date.now();
      if (cfg.dryRun) {
        appendAiLog(
          ss,
          {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            jobKey: job.jobKey,
            offreId,
            rowNumber,
            requestId,
            model: cfg.model,
            promptRendered: prompt,
            responseText: "",
            durationMs: 0,
            status: "SKIP",
            errorMessage: "DRY_RUN"
          },
          { logPayloads: cfg.logPayloads }
        );
        continue;
      }
      try {
        const cached = getCachedPromptResult(cacheKey);
        let resText = "";
        let inputTokens;
        let outputTokens;
        let totalTokens;
        let durationMs = 0;
        let statusNote = "";
        if (cached) {
          resText = cached.text;
          inputTokens = cached.inputTokens;
          outputTokens = cached.outputTokens;
          totalTokens = cached.totalTokens;
          durationMs = Date.now() - started;
          const flags = ["CACHE_HIT"];
          if (cached.usedWebSearch) flags.push("WEB_SEARCH");
          if (cached.webSearchFallback) flags.push("WEB_SEARCH_FALLBACK");
          statusNote = flags.join(" |");
        } else {
          const res = callOpenAiText(cfg, prompt, {
            rateLimitMsOverride: job.rateLimitMs
          });
          durationMs = Date.now() - started;
          resText = res.text;
          inputTokens = res.inputTokens;
          outputTokens = res.outputTokens;
          totalTokens = res.totalTokens;
          const flags = [];
          if (res.usedWebSearch) flags.push("WEB_SEARCH");
          if (res.webSearchFallback) flags.push("WEB_SEARCH_FALLBACK");
          statusNote = flags.length ? flags.join(" |") : "";
          setCachedPromptResult(cacheKey, {
            text: resText,
            inputTokens,
            outputTokens,
            totalTokens,
            usedWebSearch: res.usedWebSearch,
            webSearchFallback: res.webSearchFallback
          });
        }
        let parsed = null;
        if (job.outputMode === "json") {
          parsed = extractJsonObject(resText);
        } else if (job.outputMode === "number") {
          parsed = parseNumberStrict(resText);
        } else {
          parsed = String(resText != null ? resText : "").trim();
        }
        for (const target of job.targetColumns) {
          const colIdx0 = headerMap.get(target);
          if (colIdx0 == null) continue;
          const current = row[colIdx0];
          const isEmpty = current == null || String(current).trim() === "";
          if (job.writeStrategy === "fill_if_empty" && !isEmpty) continue;
          let v = "";
          if (job.outputMode === "json") {
            const defaultValue = parsed && typeof parsed === "object" ? (_h = parsed[target]) != null ? _h : "" : "";
            if (job.jobKey === "commercial_score" && parsed && typeof parsed === "object") {
              if (target === "Score commercial") v = (_i = parsed.score) != null ? _i : "";
              else if (target === "Keywords +") v = Array.isArray(parsed.keywords_positive) ? parsed.keywords_positive.join(", ") : "";
              else if (target === "Keywords -") v = Array.isArray(parsed.keywords_negative) ? parsed.keywords_negative.join(", ") : "";
              else if (target === "Explication") v = (_j = parsed.explanation) != null ? _j : "";
              else v = defaultValue;
            } else if (job.jobKey === "keywords" && parsed && typeof parsed === "object") {
              const kn = parsed.keywords_negative && typeof parsed.keywords_negative === "object" ? parsed.keywords_negative : null;
              const pick = (k) => Array.isArray(k) ? k.filter(Boolean).join(", ") : "";
              if (target === "Keywords - Intitule") v = pick(kn == null ? void 0 : kn.intitule);
              else if (target === "Keywords - Description") v = pick(kn == null ? void 0 : kn.description);
              else if (target === "Keywords - EntrepriseNom") v = pick(kn == null ? void 0 : kn.entrepriseNom);
              else if (target === "Keywords - EntrepriseAPropos") v = pick(kn == null ? void 0 : kn.entrepriseAPropos);
              else v = defaultValue;
            } else {
              v = defaultValue;
            }
          } else {
            v = parsed;
          }
          const willWrite = job.writeStrategy === "overwrite" || isEmpty;
          const hasValue = v != null && String(v).trim() !== "";
          if (willWrite) {
            writes.push({ rowIndex: rowNumber, colIndex: colIdx0 + 1, value: v });
            row[colIdx0] = v;
            if (job.jobKey === "completion" && isEmpty && hasValue) {
              highlightWrites.push({ rowIndex: rowNumber, colIndex: colIdx0 + 1 });
            }
          }
        }
        appendAiLog(
          ss,
          {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            jobKey: job.jobKey,
            offreId,
            rowNumber,
            requestId,
            model: cfg.model,
            promptRendered: prompt,
            responseText: resText,
            inputTokens,
            outputTokens,
            totalTokens,
            durationMs,
            status: "OK",
            errorMessage: statusNote
          },
          { logPayloads: cfg.logPayloads }
        );
      } catch (e) {
        const durationMs = Date.now() - started;
        appendAiLog(
          ss,
          {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            jobKey: job.jobKey,
            offreId,
            rowNumber,
            requestId,
            model: cfg.model,
            promptRendered: prompt,
            responseText: "",
            durationMs,
            status: "ERROR",
            errorMessage: String((e == null ? void 0 : e.message) || e)
          },
          { logPayloads: cfg.logPayloads }
        );
      }
    }
    if (writes.length) {
      for (const w of writes) {
        offres.getRange(w.rowIndex, w.colIndex, 1, 1).setValue(w.value);
      }
    }
    if (highlightWrites.length) {
      const byRow = /* @__PURE__ */ new Map();
      for (const h of highlightWrites) {
        const row = h.rowIndex;
        const col = h.colIndex;
        let entry = byRow.get(row);
        if (!entry) {
          entry = { minCol: col, maxCol: col, cols: /* @__PURE__ */ new Set() };
          byRow.set(row, entry);
        }
        entry.minCol = Math.min(entry.minCol, col);
        entry.maxCol = Math.max(entry.maxCol, col);
        entry.cols.add(col);
      }
      for (const [row, entry] of byRow) {
        const width = entry.maxCol - entry.minCol + 1;
        const rowColors = new Array(width).fill("");
        for (let c = entry.minCol; c <= entry.maxCol; c++) {
          if (entry.cols.has(c)) rowColors[c - entry.minCol] = "#d9ead3";
        }
        offres.getRange(row, entry.minCol, 1, width).setBackgrounds([rowColors]);
      }
    }
  }
  function runAllEnabledJobs() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jobs = loadJobsConfig(ss);
    for (const [k, job] of jobs) {
      if (!job.enabled) continue;
      runJob(k);
    }
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
    try {
      ensureAiSheets(ss);
    } catch (_e) {
    }
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
    ui.createMenu("France Travail").addItem("Initialiser", "ftInit").addItem("Health check", "ftHealthCheck").addSeparator().addItem("Mettre \xE0 jour (24h)", "ftUpdateTravailleurSocial_24h").addItem("Mettre \xE0 jour (7j)", "ftUpdateTravailleurSocial_7j").addItem("Mettre \xE0 jour (31j)", "ftUpdateTravailleurSocial_31j").addSeparator().addItem("Configurer les secrets", "ftConfigureSecrets").addItem("Ouvrir l\u2019onglet Exclusions", "ftOpenExclusions").addToUi();
    ui.createMenu("Agents").addItem("Configurer (OpenAI)", "ftAgentsConfigure").addSeparator().addItem("Run completion", "ftAgentsRunCompletion").addItem("Run score", "ftAgentsRunScore").addItem("Run commercial score", "ftAgentsRunCommercialScore").addItem("Run keywords (negative)", "ftAgentsRunKeywords").addSeparator().addItem("Run all enabled jobs", "ftAgentsRunAllEnabled").addSeparator().addItem("Ouvrir Config (Agents)", "ftAgentsOpenConfig").addItem("Ouvrir Jobs", "ftAgentsOpenJobs").addItem("Ouvrir Logs", "ftAgentsOpenLogs").addToUi();
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
  function ftAgentsConfigure() {
    promptAndStoreAiConfig();
    SpreadsheetApp.getUi().alert(
      "Agents",
      "Configuration OpenAI enregistr\xE9e dans Script Properties.",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
  function ftAgentsOpenConfig() {
    SpreadsheetApp.getUi().alert(
      "Agents",
      "La config Agents (OpenAI) est stock\xE9e dans Script Properties.\n\nMenu: Agents > Configurer (OpenAI)",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
  function ftAgentsOpenJobs() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureAiSheets(ss);
    activateAiSheet(ss, AI_SHEETS.JOBS);
  }
  function ftAgentsOpenLogs() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureAiSheets(ss);
    activateAiSheet(ss, AI_SHEETS.LOGS);
  }
  function ftAgentsRunCompletion() {
    runJob("completion");
  }
  function ftAgentsRunScore() {
    runJob("score");
  }
  function ftAgentsRunCommercialScore() {
    runJob("commercial_score");
  }
  function ftAgentsRunKeywords() {
    runJob("keywords");
  }
  function ftAgentsRunAllEnabled() {
    runAllEnabledJobs();
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
  G.ftUpdateTravailleurSocial_24h = ftUpdateTravailleurSocial_24h;
  G.ftUpdateTravailleurSocial_7j = ftUpdateTravailleurSocial_7j;
  G.ftUpdateTravailleurSocial_31j = ftUpdateTravailleurSocial_31j;
  G.ftUpdateTravailleurSocial_30j = ftUpdateTravailleurSocial_30j;
  G.ftDebugPing = ftDebugPing;
  G.ftShowSecretsMissing = ftShowSecretsMissing;
  G.ftHealthCheckSilent = ftHealthCheckSilent;
  G.ftHealthCheck = ftHealthCheck;
  G.ftAgentsConfigure = ftAgentsConfigure;
  G.ftAgentsOpenConfig = ftAgentsOpenConfig;
  G.ftAgentsOpenJobs = ftAgentsOpenJobs;
  G.ftAgentsOpenLogs = ftAgentsOpenLogs;
  G.ftAgentsRunCompletion = ftAgentsRunCompletion;
  G.ftAgentsRunScore = ftAgentsRunScore;
  G.ftAgentsRunCommercialScore = ftAgentsRunCommercialScore;
  G.ftAgentsRunKeywords = ftAgentsRunKeywords;
  G.ftAgentsRunAllEnabled = ftAgentsRunAllEnabled;
  G.runJob = runJob;
  G.runAllEnabledJobs = runAllEnabledJobs;
