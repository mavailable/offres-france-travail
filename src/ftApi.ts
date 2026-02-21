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

export function getToken(secrets: FtSecrets): string {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG.TOKEN_CACHE_KEY);
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
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    scope: "api_offresdemploiv2 o2dsoffre", // tolerant (FT accepts various scopes per app)
  });

  const { code, json, rawText } = fetchJson(CONFIG.OAUTH_TOKEN_URL, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload,
    headers: {
      Accept: "application/json",
    },
  });

  if (code < 200 || code >= 300 || !json || !json.access_token) {
    throw new Error(
      `❌ OAuth token error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
    );
  }

  const token = (json as TokenResponse).access_token;
  cache.put(CONFIG.TOKEN_CACHE_KEY, JSON.stringify({ access_token: token }), CONFIG.TOKEN_CACHE_TTL_SECONDS);
  return token;
}

export function clearTokenCache(): void {
  CacheService.getScriptCache().remove(CONFIG.TOKEN_CACHE_KEY);
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
    // Token likely expired/invalid, clear cache and retry once.
    clearTokenCache();
    return searchOffersOnce(secrets, opts, range, false);
  }

  if (code < 200 || code >= 300) {
    throw new Error(
      `❌ FT search error HTTP ${code}: ${rawText ? rawText.slice(0, 600) : "(empty body)"}`
    );
  }

  const results = (json && (json.resultats || json.results || json.offres)) as any[] | undefined;
  const arr = Array.isArray(results) ? results : [];
  return arr.map(mapOffer).filter((x): x is OfferApi => Boolean(x));
}
