import { CONFIG } from "./config";

export interface ExclusionRule {
  raw: string;
  isRegex: boolean;
  regex?: RegExp;
  normalizedNeedle?: string; // for "contains"
}

export interface Exclusions {
  intituleRules: ExclusionRule[];
  entrepriseRules: ExclusionRule[];
}

export function normalizeText(input: string): string {
  // trim, lowercase, remove accents, normalize spaces
  const s = (input || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/\s+/g, " ");
  return s;
}

/**
 * Supports regex in the form /pattern/flags
 * Otherwise uses a normalized "contains" match.
 */
export function parseRule(raw: string): ExclusionRule | null {
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
      // Fall back to contains (treat as literal) if regex invalid
      return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
    }
  }

  return { raw: r, isRegex: false, normalizedNeedle: normalizeText(r) };
}

export function loadExclusions(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): Exclusions {
  const sheet = ss.getSheetByName(CONFIG.SHEET_EXCLUSIONS);
  if (!sheet) {
    // Should have been ensured by sheet.ts, but keep robust.
    return { intituleRules: [], entrepriseRules: [] };
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { intituleRules: [], entrepriseRules: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues() as unknown[][];
  const intituleRules: ExclusionRule[] = [];
  const entrepriseRules: ExclusionRule[] = [];

  for (const row of values) {
    const a = String(row[0] ?? "").trim();
    const b = String(row[1] ?? "").trim();
    const ra = parseRule(a);
    const rb = parseRule(b);
    if (ra) intituleRules.push(ra);
    if (rb) entrepriseRules.push(rb);
  }

  return { intituleRules, entrepriseRules };
}

export function matchesAnyRule(text: string, rules: ExclusionRule[]): boolean {
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

export function isExcluded(
  offer: { intitule: string; entrepriseNom: string },
  exclusions: Exclusions
): boolean {
  const title = offer.intitule || "";
  const company = offer.entrepriseNom || "";

  if (matchesAnyRule(title, exclusions.intituleRules)) return true;
  if (matchesAnyRule(company, exclusions.entrepriseRules)) return true;
  return false;
}
