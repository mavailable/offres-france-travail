import { CONFIG } from "./config";
import type { FtSecrets } from "./secrets";

export interface OfferApi {
  id: string;
  dateCreation: string; // ISO string
  intitule: string;
  description: string;
  entrepriseNom: string;
  contactNom: string;
  contactEmail: string;
  contactTelephone: string;
  entrepriseAPropos: string;
  codePostal: string;
  typeContratLibelle: string;
  dureeTravailLibelle: string;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function urlEncodeForm(data: Record<string, string>): string {
  return Object.keys(data)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(data[k]))
    .join("&");
}

function fetchJson(
  url: string,
  params: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions
): { code: number; json: any; rawText: string } {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, ...params });
  const code = res.getResponseCode();
  const rawText = res.getContentText() || "";
  let json: any = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch (_e) {
    json = null;
  }
  return { code, json, rawText };
}

function tokenCacheKey(clientId: string, scope: string): string {
  const id = String(clientId || "").trim();
  const sc = String(scope || "").trim();
  // Non-sensitive stable key; avoids cross-client collisions.
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${id}|${sc}`, Utilities.Charset.UTF_8);
  const shaHex = bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  return `${CONFIG.TOKEN_CACHE_KEY}_${shaHex.slice(0, 12)}`;
}

export function getToken(secrets: FtSecrets): string {
  const clientId = String(secrets?.clientId || "").trim();
  const clientSecret = String(secrets?.clientSecret || "").trim();
  const scope = "api_offresdemploiv2 o2dsoffre";

  const cache = CacheService.getScriptCache();
  const cacheKey = tokenCacheKey(clientId, scope);

  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const obj = JSON.parse(cached) as { access_token: string };
      if (obj.access_token) return obj.access_token;
    } catch (_e) {
      // ignore and refresh
    }
  }

  const payload = urlEncodeForm({
    grant_type: "client_credentials",
    // Do NOT include client_id / client_secret in the body when using Basic auth.
    // Some OAuth servers reject requests with duplicated client authentication.
    scope,
  });

  // RFC 6749: client authentication via HTTP Basic is widely expected.
  const basic = Utilities.base64Encode(`${clientId}:${clientSecret}`);

  const { code, json, rawText } = fetchJson(CONFIG.OAUTH_TOKEN_URL, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
  });

  if (code < 200 || code >= 300 || !json || !json.access_token) {
    const safeId = clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-4)}` : "(empty)";
    throw new Error(
      `❌ OAuth token error HTTP ${code} (client_id=${safeId}): ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
    );
  }

  const token = (json as TokenResponse).access_token;
  cache.put(cacheKey, JSON.stringify({ access_token: token }), CONFIG.TOKEN_CACHE_TTL_SECONDS);
  return token;
}

export function clearTokenCache(secrets?: FtSecrets): void {
  const cache = CacheService.getScriptCache();
  // Backward-compat: clear old fixed key + derived key when possible.
  try {
    cache.remove(CONFIG.TOKEN_CACHE_KEY);
  } catch (_e) {
    // ignore
  }

  if (secrets) {
    try {
      const cacheKey = tokenCacheKey(String(secrets.clientId || ""), "api_offresdemploiv2 o2dsoffre");
      cache.remove(cacheKey);
    } catch (_e) {
      // ignore
    }
  }
}

function mapOffer(o: any): OfferApi | null {
  if (!o) return null;
  const id = String(o.id ?? "").trim();
  if (!id) return null;

  const entrepriseNom = String(o.entreprise?.nom ?? o.entrepriseNom ?? "");

  // contact.nom is often formatted like: "ENTREPRISE - Mme Prénom NOM"
  // We keep only the part after the first " - ".
  // Also ignore "Agence France..." pseudo-contacts.
  let contactNomRaw = String(o.contact?.nom ?? o.contactNom ?? "").trim();
  if (/^Agence France/i.test(contactNomRaw)) {
    contactNomRaw = "";
  } else {
    const parts = contactNomRaw.split(" - ");
    if (parts.length >= 2) contactNomRaw = parts.slice(1).join(" - ").trim();
  }

  // "À propos de l'entreprise": per FT "offres search" JSON, this is strictly o.entreprise.description.
  // Do not fallback to other fields to avoid mixing job-related content (e.g. diplomas).
  const entrepriseAProposRaw = String(o.entreprise?.description ?? "").trim();

  return {
    id,
    dateCreation: String(o.dateCreation ?? ""),
    intitule: String(o.intitule ?? ""),
    description: String(o.description ?? ""),
    entrepriseNom,
    contactNom: contactNomRaw,
    contactEmail: String(o.contact?.email ?? o.contactEmail ?? ""),
    contactTelephone: String(o.contact?.telephone ?? o.contactTelephone ?? ""),
    entrepriseAPropos: entrepriseAProposRaw,
    codePostal: String(o.lieuTravail?.codePostal ?? o.codePostal ?? ""),
    typeContratLibelle: String(o.typeContratLibelle ?? ""),
    dureeTravailLibelle: String(o.dureeTravailLibelle ?? ""),
  };
}

function buildOfferUrl(offerId: string): string {
  // A usable human URL (not the API endpoint)
  // Note: FT might redirect depending on locale; this is a stable pattern used in practice.
  return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(offerId)}`;
}

export function getOfferPublicUrl(offerId: string): string {
  return buildOfferUrl(offerId);
}

/**
 * Calls the Offres v2 search endpoint with pagination (range=0-149, etc.).
 * Retries once on HTTP 401 after clearing token cache.
 */
export function searchOffersPaged(
  secrets: FtSecrets,
  opts: { motsCles: string; publieeDepuis: number }
): OfferApi[] {
  const all: OfferApi[] = [];
  let start = 0;

  for (let page = 0; page < CONFIG.MAX_PAGES; page++) {
    const end = start + CONFIG.PAGE_SIZE - 1;
    const range = `${start}-${end}`;

    const pageOffers = searchOffersOnce(secrets, opts, range, /*allowRetry401*/ true);
    if (!pageOffers.length) break;

    all.push(...pageOffers);
    if (pageOffers.length < CONFIG.PAGE_SIZE) break;

    start += CONFIG.PAGE_SIZE;
  }

  return all;
}

function searchOffersOnce(
  secrets: FtSecrets,
  opts: { motsCles: string; publieeDepuis: number },
  range: string,
  allowRetry401: boolean
): OfferApi[] {
  const token = getToken(secrets);

  const qs =
    `motsCles=${encodeURIComponent(opts.motsCles)}` +
    `&publieeDepuis=${encodeURIComponent(String(opts.publieeDepuis))}` +
    `&range=${encodeURIComponent(range)}`;

  const url = `${CONFIG.OFFRES_SEARCH_URL}?${qs}`;

  const { code, json, rawText } = fetchJson(url, {
    method: "get",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (code === 401 && allowRetry401) {
    clearTokenCache(secrets);
    return searchOffersOnce(secrets, opts, range, false);
  }

  if (code < 200 || code >= 300) {
    const safeId = secrets?.clientId
      ? `${String(secrets.clientId).trim().slice(0, 6)}…${String(secrets.clientId).trim().slice(-4)}`
      : "(empty)";
    throw new Error(
      `❌ FT search error HTTP ${code} (client_id=${safeId}): ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
    );
  }

  const results = (json && (json.resultats || json.results || json.offres)) as any[] | undefined;
  const arr = Array.isArray(results) ? results : [];
  return arr.map(mapOffer).filter((x): x is OfferApi => Boolean(x));
}
