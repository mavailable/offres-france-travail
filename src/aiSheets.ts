import { CONFIG } from "./config";

export const AI_SHEETS = {
  JOBS: "Jobs",
  LOGS: "Logs",
} as const;

export const HEADERS_JOBS = [
  "job_key",
  "enabled",
  "prompt_template",
  "output_mode",
  "schema_json",
  "target_columns",
  "write_strategy",
  "rate_limit_ms",
] as const;

export const HEADERS_LOGS = [
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
  "error_message",
] as const;

export function ensureAiSheets(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): {
  jobs: GoogleAppsScript.Spreadsheet.Sheet;
  logs: GoogleAppsScript.Spreadsheet.Sheet;
} {
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

  // Seed MVP jobs if sheet is empty (no rows beyond header).
  try {
    const lastRow = jobs.getLastRow();
    if (jobsWasCreated || lastRow < 2) {
      const completionPrompt = [
        "Tu es un assistant qui structure des offres d'emploi.",
        "Retourne STRICTEMENT un JSON (sans texte autour) avec les clés suivantes : Entreprise, Contact, Email, Téléphone, À propos, Résumé, ETP.",
        "Entreprise doit être le nom de l'entreprise (string).",
        "ETP doit être un pourcentage sous forme de texte, ex: \"100%\", \"80%\". Si inconnue, chaîne vide.",
        "Si une info est absente, mets une chaîne vide.",
        "\nDonnées brutes (JSON FT):",
        "{{Import.raw_json}}",
      ].join("\n");

      const scorePrompt = [
        "Donne un score entre 0 et 100 (nombre uniquement) selon la qualité/pertinence de l'offre.",
        "Ne retourne rien d'autre que le nombre.",
        "\nContexte:",
        "Poste: {{Offres.Poste}}",
        "Entreprise: {{Offres.Entreprise}}",
        "Résumé: {{Offres.Résumé}}",
        "Brut: {{Import.raw_json}}",
      ].join("\n");

      const commercialScorePrompt = [
        "Tu es un moteur de scoring commercial pour proposer un travailleur social indépendant.",
        "",
        "À partir du JSON brut de l’offre ci-dessous, calcule un score final borné entre 0 et 100.",
        "Le score mesure la pertinence commerciale (probabilité de vendre une prestation d’indépendant), pas l’intérêt du poste pour un candidat.",
        "",
        "Barème (appliquer dans cet ordre) :",
        "",
        "1) Temps partiel — 0 à 40 pts",
        "- ≤20%: 40",
        "- 21–30%: 32",
        "- 31–40%: 24",
        "- 41–50%: 16",
        "- non précisé: 10",
        "- >50%: 0",
        "",
        "2) Besoin difficile / morcelé — 0 à 30 pts",
        "(remplacement, urgence, complément, CDD court, difficulté)",
        "Attribuer 0 / 15 / 30 selon intensité détectée dans l’annonce.",
        "",
        "3) Type de structure — 0 à 20 pts",
        "- Institution: 0–5",
        "- Établissement local: 6–14",
        "- Petite asso / structure isolée: 15–20",
        "",
        "4) Contact exploitable — 0 à 10 pts",
        "- Email direct: 10",
        "- Email générique: 5",
        "- Aucun: 0",
        "",
        "Malus obligatoire",
        "Si l’annonce est émise par un cabinet de recrutement / intérim / intermédiaire → -40 pts.",
        "",
        "Consignes d’extraction :",
        "- Utilise les champs pertinents du JSON (ex: description, entreprise/nom, type d’employeur, contact, etc.).",
        "- Déduis le % temps partiel à partir d’indices comme “XXH/semaine”, “temps partiel”, “ETP”, “mi-temps”, etc.",
        "- Pour “keywords”, retourne des mots/expressions COURTES réellement présentes (ou quasi mot pour mot) dans l’annonce.",
        "- Si tu ne trouves pas d’élément probant pour un critère, applique la valeur “non précisé” ou une intensité faible.",
        "",
        "Sortie :",
        "Retourne UNIQUEMENT un JSON valide exactement au format suivant (aucun texte autour) :",
        "",
        "{",
        "  \"score\": 0,",
        "  \"keywords_positive\": [\"...\"],",
        "  \"keywords_negative\": [\"...\"],",
        "  \"explanation\": \"...\"",
        "}",
        "",
        "Contraintes :",
        "- \"score\" doit être un entier.",
        "- \"keywords_positive\" et \"keywords_negative\": 3 à 8 éléments chacun (moins si vraiment impossible).",
        "- \"explanation\": UNE seule phrase, courte, qui résume les facteurs principaux (incluant le malus si appliqué).",
        "",
        "OFFRE (JSON brut) :",
        "{{Import.raw_json}}",
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
        "{{Import.raw_json}}",
      ].join("\n");

      const rows = [
        [
          "completion",
          "TRUE",
          completionPrompt,
          "json",
          "",
          "Entreprise,Contact,Email,Téléphone,À propos,Résumé,ETP",
          "fill_if_empty",
          "",
        ],
        [
          "score",
          "TRUE",
          scorePrompt,
          "number",
          "",
          "Score",
          "overwrite",
          "",
        ],
        [
          "commercial_score",
          "TRUE",
          commercialScorePrompt,
          "json",
          "",
          "Score commercial,Keywords +,Keywords -,Explication",
          "overwrite",
          "",
        ],
        [
          "keywords",
          "TRUE",
          keywordsPrompt,
          "json",
          "",
          "Keywords - Intitule,Keywords - Description,Keywords - EntrepriseNom,Keywords - EntrepriseAPropos",
          "overwrite",
          "",
        ],
      ];

      jobs.getRange(2, 1, rows.length, HEADERS_JOBS.length).setValues(rows);
      jobs.setRowHeights(2, rows.length, 60);
      jobs.getRange(2, 2, rows.length, 1).insertCheckboxes();
      jobs.getRange(2, 3, rows.length, 1).setWrap(true);
    }
  } catch (_e) {
    // ignore
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

export function activateAiSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, name: string): void {
  const sheet = ss.getSheetByName(name);
  if (sheet) ss.setActiveSheet(sheet);
}
