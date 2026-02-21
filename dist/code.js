/**
 * Centralized configuration & constants.
 * Keep this file boring and explicit.
 */
System.register("config", [], function (exports_1, context_1) {
    "use strict";
    var CONFIG, HEADERS_OFFRES, HEADERS_EXCLUSIONS;
    var __moduleName = context_1 && context_1.id;
    return {
        setters: [],
        execute: function () {
            exports_1("CONFIG", CONFIG = {
                // Sheets
                SHEET_OFFRES: "Offres",
                SHEET_EXCLUSIONS: "Exclusions",
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
                TOKEN_CACHE_TTL_SECONDS: 50 * 60, // 50 minutes
                // Column definitions (1-based indexes)
                COLS: {
                    dateCreation: 1,
                    intitule: 2,
                    resume: 3,
                    entrepriseNom: 4,
                    codePostal: 5,
                    typeContrat: 6,
                    dureeTravail: 7,
                    offreId: 8, // technical (hidden)
                    TOTAL: 8,
                },
                // Formatting
                HEADER_ROW: 1,
                DATA_START_ROW: 2,
                ROW_HEIGHT_PX: 21,
                // Column widths (px)
                COL_WIDTHS: {
                    dateCreation: 120,
                    intitule: 340,
                    resume: 380,
                    entrepriseNom: 220,
                    codePostal: 110,
                    typeContrat: 160,
                    dureeTravail: 220,
                    offreId: 80, // hidden anyway
                },
                // Notes
                RESUME_NOTE_PREFIX: "Description:\n",
                // Secrets keys (Script Properties)
                SECRETS: {
                    CLIENT_ID: "FT_CLIENT_ID",
                    CLIENT_SECRET: "FT_CLIENT_SECRET",
                },
                // Logging
                LOG_PREFIX: "[FT]",
            });
            exports_1("HEADERS_OFFRES", HEADERS_OFFRES = [
                "dateCreation",
                "intitule",
                "resume",
                "entreprise_nom",
                "lieu_codePostal",
                "typeContratLibelle",
                "dureeTravailLibelle",
                "offre_id",
            ]);
            exports_1("HEADERS_EXCLUSIONS", HEADERS_EXCLUSIONS = [
                "Exclure si intitulé contient / match",
                "Exclure si entreprise contient / match",
            ]);
        }
    };
});
System.register("exclusions", ["config"], function (exports_2, context_2) {
    "use strict";
    var config_1;
    var __moduleName = context_2 && context_2.id;
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
    exports_2("normalizeText", normalizeText);
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
    exports_2("parseRule", parseRule);
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
    exports_2("loadExclusions", loadExclusions);
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
    exports_2("matchesAnyRule", matchesAnyRule);
    function isExcluded(offer, exclusions) {
        const title = offer.intitule || "";
        const company = offer.entrepriseNom || "";
        if (matchesAnyRule(title, exclusions.intituleRules))
            return true;
        if (matchesAnyRule(company, exclusions.entrepriseRules))
            return true;
        return false;
    }
    exports_2("isExcluded", isExcluded);
    return {
        setters: [
            function (config_1_1) {
                config_1 = config_1_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("secrets", ["config"], function (exports_3, context_3) {
    "use strict";
    var config_2;
    var __moduleName = context_3 && context_3.id;
    function getSecrets() {
        const props = PropertiesService.getScriptProperties();
        const clientId = (props.getProperty(config_2.CONFIG.SECRETS.CLIENT_ID) || "").trim();
        const clientSecret = (props.getProperty(config_2.CONFIG.SECRETS.CLIENT_SECRET) || "").trim();
        if (!clientId || !clientSecret)
            return null;
        return { clientId, clientSecret };
    }
    exports_3("getSecrets", getSecrets);
    function setSecrets(secrets) {
        const props = PropertiesService.getScriptProperties();
        props.setProperties({
            [config_2.CONFIG.SECRETS.CLIENT_ID]: secrets.clientId.trim(),
            [config_2.CONFIG.SECRETS.CLIENT_SECRET]: secrets.clientSecret.trim(),
        }, true);
    }
    exports_3("setSecrets", setSecrets);
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
    exports_3("promptAndStoreSecrets", promptAndStoreSecrets);
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
    exports_3("ensureSecrets", ensureSecrets);
    return {
        setters: [
            function (config_2_1) {
                config_2 = config_2_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("ftApi", ["config"], function (exports_4, context_4) {
    "use strict";
    var config_3;
    var __moduleName = context_4 && context_4.id;
    function urlEncodeForm(data) {
        return Object.keys(data)
            .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(data[k]))
            .join("&");
    }
    function fetchJson(url, params) {
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, ...params });
        const code = res.getResponseCode();
        const rawText = res.getContentText() || "";
        let json = null;
        try {
            json = rawText ? JSON.parse(rawText) : null;
        }
        catch (_e) {
            json = null;
        }
        return { code, json, rawText };
    }
    function getToken(secrets) {
        const cache = CacheService.getScriptCache();
        const cached = cache.get(config_3.CONFIG.TOKEN_CACHE_KEY);
        if (cached) {
            try {
                const obj = JSON.parse(cached);
                if (obj.access_token)
                    return obj.access_token;
            }
            catch (_e) {
                // ignore and refresh
            }
        }
        const payload = urlEncodeForm({
            grant_type: "client_credentials",
            client_id: secrets.clientId,
            client_secret: secrets.clientSecret,
            scope: "api_offresdemploiv2 o2dsoffre", // tolerant (FT accepts various scopes per app)
        });
        const { code, json, rawText } = fetchJson(config_3.CONFIG.OAUTH_TOKEN_URL, {
            method: "post",
            contentType: "application/x-www-form-urlencoded",
            payload,
            headers: {
                Accept: "application/json",
            },
        });
        if (code < 200 || code >= 300 || !json || !json.access_token) {
            throw new Error(`❌ OAuth token error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`);
        }
        const token = json.access_token;
        cache.put(config_3.CONFIG.TOKEN_CACHE_KEY, JSON.stringify({ access_token: token }), config_3.CONFIG.TOKEN_CACHE_TTL_SECONDS);
        return token;
    }
    exports_4("getToken", getToken);
    function clearTokenCache() {
        CacheService.getScriptCache().remove(config_3.CONFIG.TOKEN_CACHE_KEY);
    }
    exports_4("clearTokenCache", clearTokenCache);
    function mapOffer(o) {
        var _a, _b, _c, _d, _f, _g, _h, _j, _k, _l, _m, _o;
        if (!o)
            return null;
        const id = String((_a = o.id) !== null && _a !== void 0 ? _a : "").trim();
        if (!id)
            return null;
        return {
            id,
            dateCreation: String((_b = o.dateCreation) !== null && _b !== void 0 ? _b : ""),
            intitule: String((_c = o.intitule) !== null && _c !== void 0 ? _c : ""),
            description: String((_d = o.description) !== null && _d !== void 0 ? _d : ""),
            entrepriseNom: String((_h = (_g = (_f = o.entreprise) === null || _f === void 0 ? void 0 : _f.nom) !== null && _g !== void 0 ? _g : o.entrepriseNom) !== null && _h !== void 0 ? _h : ""),
            codePostal: String((_l = (_k = (_j = o.lieuTravail) === null || _j === void 0 ? void 0 : _j.codePostal) !== null && _k !== void 0 ? _k : o.codePostal) !== null && _l !== void 0 ? _l : ""),
            typeContratLibelle: String((_m = o.typeContratLibelle) !== null && _m !== void 0 ? _m : ""),
            dureeTravailLibelle: String((_o = o.dureeTravailLibelle) !== null && _o !== void 0 ? _o : ""),
        };
    }
    function buildOfferUrl(offerId) {
        // A usable human URL (not the API endpoint)
        // Note: FT might redirect depending on locale; this is a stable pattern used in practice.
        return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(offerId)}`;
    }
    function getOfferPublicUrl(offerId) {
        return buildOfferUrl(offerId);
    }
    exports_4("getOfferPublicUrl", getOfferPublicUrl);
    /**
     * Calls the Offres v2 search endpoint with pagination (range=0-149, etc.).
     * Retries once on HTTP 401 after clearing token cache.
     */
    function searchOffersPaged(secrets, opts) {
        const all = [];
        let start = 0;
        for (let page = 0; page < config_3.CONFIG.MAX_PAGES; page++) {
            const end = start + config_3.CONFIG.PAGE_SIZE - 1;
            const range = `${start}-${end}`;
            const pageOffers = searchOffersOnce(secrets, opts, range, /*allowRetry401*/ true);
            if (!pageOffers.length)
                break;
            all.push(...pageOffers);
            if (pageOffers.length < config_3.CONFIG.PAGE_SIZE)
                break;
            start += config_3.CONFIG.PAGE_SIZE;
        }
        return all;
    }
    exports_4("searchOffersPaged", searchOffersPaged);
    function searchOffersOnce(secrets, opts, range, allowRetry401) {
        const token = getToken(secrets);
        const qs = `motsCles=${encodeURIComponent(opts.motsCles)}` +
            `&publieeDepuis=${encodeURIComponent(String(opts.publieeDepuis))}` +
            `&range=${encodeURIComponent(range)}`;
        const url = `${config_3.CONFIG.OFFRES_SEARCH_URL}?${qs}`;
        const { code, json, rawText } = fetchJson(url, {
            method: "get",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });
        if (code === 401 && allowRetry401) {
            // Token likely expired/invalid, clear cache and retry once.
            clearTokenCache();
            return searchOffersOnce(secrets, opts, range, false);
        }
        if (code < 200 || code >= 300) {
            throw new Error(`❌ FT search error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`);
        }
        const results = (json && (json.resultats || json.results || json.offres));
        const arr = Array.isArray(results) ? results : [];
        return arr.map(mapOffer).filter((x) => Boolean(x));
    }
    return {
        setters: [
            function (config_3_1) {
                config_3 = config_3_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("sheet", ["config"], function (exports_5, context_5) {
    "use strict";
    var config_4;
    var __moduleName = context_5 && context_5.id;
    function ensureSheets(ss) {
        let offres = ss.getSheetByName(config_4.CONFIG.SHEET_OFFRES);
        let offresWasCreated = false;
        if (!offres) {
            offres = ss.insertSheet(config_4.CONFIG.SHEET_OFFRES);
            offresWasCreated = true;
        }
        let exclusions = ss.getSheetByName(config_4.CONFIG.SHEET_EXCLUSIONS);
        if (!exclusions) {
            exclusions = ss.insertSheet(config_4.CONFIG.SHEET_EXCLUSIONS);
            setupExclusionsSheet(exclusions);
        }
        else {
            ensureExclusionsHeaders(exclusions);
        }
        ensureOffresHeaders(offres);
        ensureOffresFormatting(offres, offresWasCreated);
        return { offres, exclusions, offresWasCreated };
    }
    exports_5("ensureSheets", ensureSheets);
    function ensureOffresHeaders(sheet) {
        const headerRange = sheet.getRange(config_4.CONFIG.HEADER_ROW, 1, 1, config_4.CONFIG.COLS.TOTAL);
        const current = headerRange.getValues()[0].map(String);
        const expected = config_4.HEADERS_OFFRES;
        const same = current.length === expected.length &&
            expected.every((v, i) => (current[i] || "").trim() === v);
        if (!same) {
            headerRange.setValues([expected]);
        }
        sheet.setFrozenRows(1);
        // Header styling
        headerRange
            .setFontWeight("bold")
            .setBackground("#f1f3f4")
            .setHorizontalAlignment("center");
    }
    function ensureOffresFormatting(sheet, isFirstSetup) {
        // Column widths
        sheet.setColumnWidth(config_4.CONFIG.COLS.dateCreation, config_4.CONFIG.COL_WIDTHS.dateCreation);
        sheet.setColumnWidth(config_4.CONFIG.COLS.intitule, config_4.CONFIG.COL_WIDTHS.intitule);
        sheet.setColumnWidth(config_4.CONFIG.COLS.resume, config_4.CONFIG.COL_WIDTHS.resume);
        sheet.setColumnWidth(config_4.CONFIG.COLS.entrepriseNom, config_4.CONFIG.COL_WIDTHS.entrepriseNom);
        sheet.setColumnWidth(config_4.CONFIG.COLS.codePostal, config_4.CONFIG.COL_WIDTHS.codePostal);
        sheet.setColumnWidth(config_4.CONFIG.COLS.typeContrat, config_4.CONFIG.COL_WIDTHS.typeContrat);
        sheet.setColumnWidth(config_4.CONFIG.COLS.dureeTravail, config_4.CONFIG.COL_WIDTHS.dureeTravail);
        sheet.setColumnWidth(config_4.CONFIG.COLS.offreId, config_4.CONFIG.COL_WIDTHS.offreId);
        // Hide technical column
        sheet.hideColumns(config_4.CONFIG.COLS.offreId);
        // Data range formatting (wrap off, clip)
        const maxRows = Math.max(sheet.getMaxRows(), 200);
        if (sheet.getMaxRows() < maxRows)
            sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
        const dataRange = sheet.getRange(1, 1, maxRows, config_4.CONFIG.COLS.TOTAL);
        dataRange.setWrap(false).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
        // Row heights (avoid auto-height from notes)
        // Applying to a "buffer" number of rows keeps the sheet clean without huge cost.
        const heightRows = Math.min(maxRows, 1000);
        sheet.setRowHeights(1, heightRows, config_4.CONFIG.ROW_HEIGHT_PX);
        // Date column format
        sheet.getRange(config_4.CONFIG.DATA_START_ROW, config_4.CONFIG.COLS.dateCreation, maxRows - 1, 1).setNumberFormat("yyyy-mm-dd");
        if (isFirstSetup) {
            // Useful default sort or filter could be added, but spec says keep it minimal.
        }
    }
    function setupExclusionsSheet(sheet) {
        sheet.getRange(1, 1, 1, 2).setValues([config_4.HEADERS_EXCLUSIONS]);
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(1, 360);
        sheet.setColumnWidth(2, 360);
        sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
    }
    function ensureExclusionsHeaders(sheet) {
        const headerRange = sheet.getRange(1, 1, 1, 2);
        const current = headerRange.getValues()[0].map(String);
        const expected = config_4.HEADERS_EXCLUSIONS;
        const same = expected.every((v, i) => (current[i] || "").trim() === v);
        if (!same)
            headerRange.setValues([expected]);
        sheet.setFrozenRows(1);
    }
    function loadExistingOfferIds(offresSheet) {
        var _a;
        const lastRow = offresSheet.getLastRow();
        if (lastRow < config_4.CONFIG.DATA_START_ROW)
            return new Set();
        const numRows = lastRow - config_4.CONFIG.HEADER_ROW;
        const range = offresSheet.getRange(config_4.CONFIG.DATA_START_ROW, config_4.CONFIG.COLS.offreId, numRows, 1);
        const values = range.getValues();
        const ids = new Set();
        for (const row of values) {
            const id = String((_a = row[0]) !== null && _a !== void 0 ? _a : "").trim();
            if (id)
                ids.add(id);
        }
        return ids;
    }
    exports_5("loadExistingOfferIds", loadExistingOfferIds);
    /**
     * Append offers in batch:
     * - setValues for all columns
     * - setRichTextValues for intitule column (clickable link)
     * - setNotes for resume column
     */
    function appendOffersBatch(offresSheet, rows) {
        if (!rows.length)
            return;
        const startRow = offresSheet.getLastRow() + 1;
        const values = rows.map((r) => [
            r.dateCreation,
            r.intituleText, // will be overwritten by rich text
            r.resume,
            r.entrepriseNom,
            r.codePostal,
            r.typeContratLibelle,
            r.dureeTravailLibelle,
            r.offreId,
        ]);
        const range = offresSheet.getRange(startRow, 1, rows.length, config_4.CONFIG.COLS.TOTAL);
        range.setValues(values);
        // Rich text links only on the "intitule" column
        const richTexts = rows.map((r) => SpreadsheetApp.newRichTextValue().setText(r.intituleText).setLinkUrl(r.intituleUrl).build());
        offresSheet
            .getRange(startRow, config_4.CONFIG.COLS.intitule, rows.length, 1)
            .setRichTextValues(richTexts.map((rt) => [rt]));
        // Notes for resume
        const notes = rows.map((r) => [r.resumeNote]);
        offresSheet.getRange(startRow, config_4.CONFIG.COLS.resume, rows.length, 1).setNotes(notes);
        // Keep consistent row height for appended rows (in case sheet had less rows formatted)
        offresSheet.setRowHeights(startRow, rows.length, config_4.CONFIG.ROW_HEIGHT_PX);
    }
    exports_5("appendOffersBatch", appendOffersBatch);
    function activateSheet(ss, name) {
        const sheet = ss.getSheetByName(name);
        if (sheet)
            ss.setActiveSheet(sheet);
    }
    exports_5("activateSheet", activateSheet);
    return {
        setters: [
            function (config_4_1) {
                config_4 = config_4_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("jobs", ["config", "secrets", "ftApi", "sheet", "exclusions"], function (exports_6, context_6) {
    "use strict";
    var config_5, secrets_1, ftApi_1, sheet_1, exclusions_1;
    var __moduleName = context_6 && context_6.id;
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
        const { offres } = sheet_1.ensureSheets(ss);
        // Detect if we have UI (menu/manual run) vs time-based trigger
        const allowUi = Boolean(SpreadsheetApp.getUi);
        const secrets = secrets_1.ensureSecrets(allowUi);
        const existingIds = sheet_1.loadExistingOfferIds(offres);
        const exclusions = exclusions_1.loadExclusions(ss);
        const t0 = Date.now();
        const fetched = ftApi_1.searchOffersPaged(secrets, {
            motsCles: config_5.CONFIG.SEARCH_KEYWORDS,
            publieeDepuis: config_5.CONFIG.PUBLIEE_DEPUIS_DAYS,
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
            if (exclusions_1.isExcluded(candidate, exclusions)) {
                excludedSkipped++;
                continue;
            }
            const description = o.description || "";
            const resume = firstLine(description);
            toInsert.push({
                dateCreation: toDate(o.dateCreation),
                intituleText: o.intitule || "(sans intitulé)",
                intituleUrl: ftApi_1.getOfferPublicUrl(o.id),
                resume,
                resumeNote: config_5.CONFIG.RESUME_NOTE_PREFIX + description,
                entrepriseNom: o.entrepriseNom || "",
                codePostal: o.codePostal || "",
                typeContratLibelle: o.typeContratLibelle || "",
                dureeTravailLibelle: o.dureeTravailLibelle || "",
                offreId: o.id,
            });
            existingIds.add(o.id);
        }
        sheet_1.appendOffersBatch(offres, toInsert);
        const ms = Date.now() - t0;
        console.log(`${config_5.CONFIG.LOG_PREFIX} fetched=${fetched.length} dedupSkipped=${dedupSkipped} excludedSkipped=${excludedSkipped} added=${toInsert.length} in ${ms}ms`);
    }
    exports_6("ftUpdateTravailleurSocial_24h", ftUpdateTravailleurSocial_24h);
    return {
        setters: [
            function (config_5_1) {
                config_5 = config_5_1;
            },
            function (secrets_1_1) {
                secrets_1 = secrets_1_1;
            },
            function (ftApi_1_1) {
                ftApi_1 = ftApi_1_1;
            },
            function (sheet_1_1) {
                sheet_1 = sheet_1_1;
            },
            function (exclusions_1_1) {
                exclusions_1 = exclusions_1_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("main", ["config", "secrets", "jobs", "sheet"], function (exports_7, context_7) {
    "use strict";
    var config_6, secrets_2, jobs_1, sheet_2;
    var __moduleName = context_7 && context_7.id;
    /**
     * GAS entrypoints must be global functions.
     * We re-export wrappers so clasp sees them as top-level.
     */
    function onOpen() {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        sheet_2.ensureSheets(ss);
        // If secrets missing, prompt user right away (as requested)
        if (!secrets_2.getSecrets()) {
            try {
                secrets_2.promptAndStoreSecrets();
            }
            catch (e) {
                // User cancelled; still show menu so they can configure later.
                console.log(`${config_6.CONFIG.LOG_PREFIX} secrets not configured on open: ${String(e)}`);
            }
        }
        buildMenu();
    }
    exports_7("onOpen", onOpen);
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
    exports_7("buildMenu", buildMenu);
    function ftConfigureSecrets() {
        secrets_2.promptAndStoreSecrets();
        SpreadsheetApp.getUi().alert("Secrets enregistrés dans Script Properties.");
    }
    exports_7("ftConfigureSecrets", ftConfigureSecrets);
    function ftOpenExclusions() {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        sheet_2.ensureSheets(ss);
        sheet_2.activateSheet(ss, config_6.CONFIG.SHEET_EXCLUSIONS);
    }
    exports_7("ftOpenExclusions", ftOpenExclusions);
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
    exports_7("ftHelp", ftHelp);
    return {
        setters: [
            function (config_6_1) {
                config_6 = config_6_1;
            },
            function (secrets_2_1) {
                secrets_2 = secrets_2_1;
            },
            function (jobs_1_1) {
                jobs_1 = jobs_1_1;
            },
            function (sheet_2_1) {
                sheet_2 = sheet_2_1;
            }
        ],
        execute: function () {
            exports_7("ftUpdateTravailleurSocial_24h", jobs_1.ftUpdateTravailleurSocial_24h);
            globalThis.onOpen = onOpen;
            globalThis.buildMenu = buildMenu;
            globalThis.ftConfigureSecrets = ftConfigureSecrets;
            globalThis.ftOpenExclusions = ftOpenExclusions;
            globalThis.ftHelp = ftHelp;
            globalThis.ftUpdateTravailleurSocial_24h = jobs_1.ftUpdateTravailleurSocial_24h;
        }
    };
});
