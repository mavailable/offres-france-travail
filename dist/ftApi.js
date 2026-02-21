"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToken = getToken;
exports.clearTokenCache = clearTokenCache;
exports.getOfferPublicUrl = getOfferPublicUrl;
exports.searchOffersPaged = searchOffersPaged;
const config_1 = require("./config");
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
    const cached = cache.get(config_1.CONFIG.TOKEN_CACHE_KEY);
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
    const { code, json, rawText } = fetchJson(config_1.CONFIG.OAUTH_TOKEN_URL, {
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
    cache.put(config_1.CONFIG.TOKEN_CACHE_KEY, JSON.stringify({ access_token: token }), config_1.CONFIG.TOKEN_CACHE_TTL_SECONDS);
    return token;
}
function clearTokenCache() {
    CacheService.getScriptCache().remove(config_1.CONFIG.TOKEN_CACHE_KEY);
}
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
/**
 * Calls the Offres v2 search endpoint with pagination (range=0-149, etc.).
 * Retries once on HTTP 401 after clearing token cache.
 */
function searchOffersPaged(secrets, opts) {
    const all = [];
    let start = 0;
    for (let page = 0; page < config_1.CONFIG.MAX_PAGES; page++) {
        const end = start + config_1.CONFIG.PAGE_SIZE - 1;
        const range = `${start}-${end}`;
        const pageOffers = searchOffersOnce(secrets, opts, range, /*allowRetry401*/ true);
        if (!pageOffers.length)
            break;
        all.push(...pageOffers);
        if (pageOffers.length < config_1.CONFIG.PAGE_SIZE)
            break;
        start += config_1.CONFIG.PAGE_SIZE;
    }
    return all;
}
function searchOffersOnce(secrets, opts, range, allowRetry401) {
    const token = getToken(secrets);
    const qs = `motsCles=${encodeURIComponent(opts.motsCles)}` +
        `&publieeDepuis=${encodeURIComponent(String(opts.publieeDepuis))}` +
        `&range=${encodeURIComponent(range)}`;
    const url = `${config_1.CONFIG.OFFRES_SEARCH_URL}?${qs}`;
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
