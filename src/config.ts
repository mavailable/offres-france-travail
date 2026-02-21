/**
 * Centralized configuration & constants.
 * Keep this file boring and explicit.
 */

export const CONFIG = {
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
    contactNom: 5,
    codePostal: 6,
    typeContrat: 7,
    dureeTravail: 8,
    contactEmail: 9, // I
    contactTelephone: 10, // J
    entrepriseAPropos: 11, // K
    offreId: 12, // L (technical, hidden)
    TOTAL: 12,
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
} as const;

export const HEADERS_OFFRES: string[] = [
  "Date",
  "Poste",
  "Résumé",
  "Entreprise",
  "Contact",
  "CP",
  "Contrat",
  "ETP",
  "Email",
  "Téléphone",
  "À propos",
  "offre_ID",
];

export const HEADERS_EXCLUSIONS: string[] = [
  "Exclure si intitulé contient / match",
  "Exclure si entreprise contient / match",
];
