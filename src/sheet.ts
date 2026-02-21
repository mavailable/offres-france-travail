import { CONFIG, HEADERS_EXCLUSIONS, HEADERS_OFFRES } from "./config";

function firstLine(text: string): string {
  const s = (text || "").replace(/\r\n/g, "\n");
  const line = s.split("\n")[0] || "";
  return line.trim();
}

export function ensureSheets(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): {
  offres: GoogleAppsScript.Spreadsheet.Sheet;
  exclusions: GoogleAppsScript.Spreadsheet.Sheet;
  importSheet: GoogleAppsScript.Spreadsheet.Sheet;
  offresWasCreated: boolean;
} {
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

  // Raw import (hidden)
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
    // ignore (some contexts may disallow)
  }

  ensureOffresHeaders(offres);
  ensureOffresFormatting(offres, offresWasCreated);

  return { offres, exclusions, importSheet, offresWasCreated };
}

function ensureOffresHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const headerRange = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, CONFIG.COLS.TOTAL);
  const current = headerRange.getValues()[0].map(String);
  const expected = HEADERS_OFFRES;

  const same =
    current.length === expected.length &&
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

function ensureOffresFormatting(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  isFirstSetup: boolean
): void {
  // Column widths
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

  // Hide technical column
  sheet.hideColumns(CONFIG.COLS.offreId);

  // Data range formatting (wrap off, clip)
  const maxRows = Math.max(sheet.getMaxRows(), 200);
  if (sheet.getMaxRows() < maxRows) sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());

  const dataRange = sheet.getRange(1, 1, maxRows, CONFIG.COLS.TOTAL);
  dataRange.setWrap(false).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  // Row heights (avoid auto-height from notes)
  // Applying to a "buffer" number of rows keeps the sheet clean without huge cost.
  const heightRows = Math.min(maxRows, 1000);
  sheet.setRowHeights(1, heightRows, CONFIG.ROW_HEIGHT_PX);

  // Date column format
  sheet
    .getRange(CONFIG.DATA_START_ROW, CONFIG.COLS.dateCreation, maxRows - 1, 1)
    .setNumberFormat("dd/MM/yyyy");

  if (isFirstSetup) {
    // Useful default sort or filter could be added, but spec says keep it minimal.
  }
}

function setupExclusionsSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  sheet.getRange(1, 1, 1, 2).setValues([HEADERS_EXCLUSIONS]);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 360);
  sheet.setColumnWidth(2, 360);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
}

function ensureExclusionsHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const headerRange = sheet.getRange(1, 1, 1, 2);
  const current = headerRange.getValues()[0].map(String);
  const expected = HEADERS_EXCLUSIONS;

  const same = expected.every((v, i) => (current[i] || "").trim() === v);
  if (!same) headerRange.setValues([expected]);

  sheet.setFrozenRows(1);
}

function setupImportSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  sheet.getRange(1, 1, 1, 2).setValues([["offre_id", "raw_json"]]);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 600);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
}

function ensureImportHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const headerRange = sheet.getRange(1, 1, 1, 2);
  const current = headerRange.getValues()[0].map(String);
  const expected = ["offre_id", "raw_json"];
  const same = expected.every((v, i) => (current[i] || "").trim() === v);
  if (!same) headerRange.setValues([expected]);
  sheet.setFrozenRows(1);
}

export function loadExistingOfferIds(offresSheet: GoogleAppsScript.Spreadsheet.Sheet): Set<string> {
  const lastRow = offresSheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return new Set<string>();

  const numRows = lastRow - CONFIG.HEADER_ROW;
  const range = offresSheet.getRange(CONFIG.DATA_START_ROW, CONFIG.COLS.offreId, numRows, 1);
  const values = range.getValues();

  const ids = new Set<string>();
  for (const row of values) {
    const id = String(row[0] ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

export interface OfferRowModel {
  dateCreation: Date;
  intituleText: string;
  intituleUrl: string;
  resume: string;
  resumeNote: string;
  entrepriseNom: string;
  contactNom: string;
  codePostal: string;
  typeContratLibelle: string;
  dureeTravailLibelle: string;
  contactEmail: string;
  contactTelephone: string;
  entrepriseAPropos: string;
  entrepriseAProposNote: string;
  offreId: string;
}

/**
 * Append offers in batch:
 * - setValues for all columns
 * - setRichTextValues for intitule column (clickable link)
 * - setNotes for resume column
 */
export function appendOffersBatch(
  offresSheet: GoogleAppsScript.Spreadsheet.Sheet,
  rows: OfferRowModel[]
): void {
  if (!rows.length) return;

  const startRow = offresSheet.getLastRow() + 1;

  const values: any[][] = rows.map((r) => [
    r.dateCreation,
    r.intituleText, // will be overwritten by rich text
    r.resume,
    r.entrepriseNom,
    r.contactNom,
    r.codePostal,
    r.typeContratLibelle,
    r.dureeTravailLibelle,
    r.contactEmail,
    r.contactTelephone,
    firstLine(r.entrepriseAPropos),
    r.offreId,
  ]);

  const range = offresSheet.getRange(startRow, 1, rows.length, CONFIG.COLS.TOTAL);
  range.setValues(values);

  // Rich text links only on the "intitule" column
  const richTexts = rows.map((r) =>
    SpreadsheetApp.newRichTextValue().setText(r.intituleText).setLinkUrl(r.intituleUrl).build()
  );
  offresSheet
    .getRange(startRow, CONFIG.COLS.intitule, rows.length, 1)
    .setRichTextValues(richTexts.map((rt) => [rt]));

  // Notes for resume
  const notes = rows.map((r) => [r.resumeNote]);
  offresSheet.getRange(startRow, CONFIG.COLS.resume, rows.length, 1).setNotes(notes);

  // Notes for "À propos" (full text)
  const entrepriseNotes = rows.map((r) => [r.entrepriseAProposNote]);
  offresSheet
    .getRange(startRow, CONFIG.COLS.entrepriseAPropos, rows.length, 1)
    .setNotes(entrepriseNotes);

  // Keep consistent row height for appended rows (in case sheet had less rows formatted)
  offresSheet.setRowHeights(startRow, rows.length, CONFIG.ROW_HEIGHT_PX);
}

export function appendImportRowsBatch(
  importSheet: GoogleAppsScript.Spreadsheet.Sheet,
  rows: { offreId: string; rawJson: string }[]
): void {
  if (!rows.length) return;

  const startRow = importSheet.getLastRow() + 1;
  const values = rows.map((r) => [r.offreId, r.rawJson]);
  importSheet.getRange(startRow, 1, rows.length, 2).setValues(values);
}

export function activateSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, name: string): void {
  const sheet = ss.getSheetByName(name);
  if (sheet) ss.setActiveSheet(sheet);
}
