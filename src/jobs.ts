import { CONFIG } from "./config";
import { ensureSecrets } from "./secrets";
import { searchOffersPaged, getOfferPublicUrl } from "./ftApi";
import {
  ensureSheets,
  loadExistingOfferIds,
  appendOffersBatch,
  appendImportRowsBatch,
  type OfferRowModel,
} from "./sheet";
import { loadExclusions, isExcluded } from "./exclusions";

function firstLine(text: string): string {
  const s = (text || "").replace(/\r\n/g, "\n");
  const line = s.split("\n")[0] || "";
  return line.trim();
}

function toDate(iso: string): Date {
  // ISO string => Date. If invalid, fallback to now.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date();
  return d;
}

function parseHoursPerWeek(text: string): number | null {
  const s = String(text || "");
  // Match e.g. "35H/semaine", "21 H / semaine", etc.
  const m = s.match(/(\d{1,2}(?:[.,]\d+)?)\s*H\s*\/?\s*semaine/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function computeEtpPercent(dureeTravailLibelle: string): string {
  const hours = parseHoursPerWeek(dureeTravailLibelle);
  if (hours == null) return "";

  // Full-time reference: 35h/week
  const pct = Math.round((hours / 35) * 100);
  return `${pct}%`;
}

function ftUpdateTravailleurSocial(days: number): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { offres, importSheet } = ensureSheets(ss);

  // Detect if we have UI (menu/manual run) vs time-based trigger
  const allowUi = Boolean(SpreadsheetApp.getUi);

  const secrets = ensureSecrets(allowUi);

  const existingIds = loadExistingOfferIds(offres);
  const exclusions = loadExclusions(ss);

  const t0 = Date.now();

  const fetched = searchOffersPaged(secrets, {
    motsCles: CONFIG.SEARCH_KEYWORDS,
    publieeDepuis: days,
  });

  let dedupSkipped = 0;
  let excludedSkipped = 0;
  const toInsert: OfferRowModel[] = [];
  const importRows: { offreId: string; rawJson: string }[] = [];

  for (const o of fetched) {
    if (existingIds.has(o.id)) {
      dedupSkipped++;
      continue;
    }

    const candidate = {
      intitule: o.intitule || "",
      entrepriseNom: o.entrepriseNom || "",
    };
    if (isExcluded(candidate, exclusions)) {
      excludedSkipped++;
      continue;
    }

    const description = o.description || "";
    const resume = firstLine(description);

    const entrepriseAPropos = o.entrepriseAPropos || "";

    toInsert.push({
      dateCreation: toDate(o.dateCreation),
      intituleText: o.intitule || "(sans intitulé)",
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
      offreId: o.id,
    });

    // Keep raw API data for traceability (only for offers actually written)
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

export function ftUpdateTravailleurSocial_24h(): void {
  ftUpdateTravailleurSocial(1);
}

export function ftUpdateTravailleurSocial_7j(): void {
  ftUpdateTravailleurSocial(7);
}

export function ftUpdateTravailleurSocial_31j(): void {
  ftUpdateTravailleurSocial(31);
}

// Backward-compatible alias (API doesn't accept 30, so route to 31)
export function ftUpdateTravailleurSocial_30j(): void {
  ftUpdateTravailleurSocial_31j();
}
