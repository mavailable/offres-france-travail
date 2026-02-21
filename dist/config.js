"use strict";
/**
 * Centralized configuration & constants.
 * Keep this file boring and explicit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADERS_EXCLUSIONS = exports.HEADERS_OFFRES = exports.CONFIG = void 0;
exports.CONFIG = {
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
};
exports.HEADERS_OFFRES = [
    "dateCreation",
    "intitule",
    "resume",
    "entreprise_nom",
    "lieu_codePostal",
    "typeContratLibelle",
    "dureeTravailLibelle",
    "offre_id",
];
exports.HEADERS_EXCLUSIONS = [
    "Exclure si intitulé contient / match",
    "Exclure si entreprise contient / match",
];
