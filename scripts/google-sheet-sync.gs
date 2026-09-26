/**
 * Mhal Studio — Google Sheet → Dashboard leads sync (Google Apps Script)
 *
 * Install: in the Google Sheet, Extensions → Apps Script, paste this file, then in
 * Project Settings → Script properties add:
 *   SITE_URL     e.g. https://mhal-studio.vercel.app   (no trailing slash)
 *   SYNC_SECRET  same value as SHEET_SYNC_SECRET in Vercel
 * Reload the sheet, then use the "Dashboard" menu: "Set up automatic sync" once.
 *
 * Columns are matched by header name, so their order doesn't matter. A "Dashboard ID"
 * column is added to give each row a permanent ID — don't edit or delete it.
 */

const SHEET_INDEX = 0; // first tab
const ID_HEADER = "Dashboard ID";
const FIELDS = {
  business_name: "Business Name",
  contact_person: "Contact Person",
  position: "Position",
  phone: "Phone",
  email: "Email",
  website: "Website",
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Dashboard")
    .addItem("Sync leads now", "syncLeadsFromMenu")
    .addItem("Set up automatic sync", "setupAutoSync")
    .addToUi();
}

function syncLeadsFromMenu() {
  const result = syncLeads();
  SpreadsheetApp.getUi().alert(result.message);
}

function setupAutoSync() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "syncLeads")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncLeads").timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert("Automatic sync is on: leads sync every 5 minutes. Running a first sync now.");
  syncLeadsFromMenu();
}

function syncLeads() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, message: "Another sync is already running. Try again in a moment." };

  try {
    const props = PropertiesService.getScriptProperties();
    const siteUrl = (props.getProperty("SITE_URL") || "").replace(/\/+$/, "");
    const secret = props.getProperty("SYNC_SECRET");
    if (!siteUrl || !secret) return { ok: false, message: "Missing SITE_URL or SYNC_SECRET in Script properties." };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[SHEET_INDEX];
    const lastRow = sheet.getLastRow();
    let lastCol = sheet.getLastColumn();
    if (lastRow < 2) return { ok: true, message: "No leads to sync." };

    const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => h.trim().toLowerCase());
    const col = {};
    for (const [key, header] of Object.entries(FIELDS)) {
      const i = headers.indexOf(header.toLowerCase());
      if (i === -1) return { ok: false, message: `Column "${header}" not found in row 1.` };
      col[key] = i;
    }

    // Find or create the ID column
    let idCol = headers.indexOf(ID_HEADER.toLowerCase());
    if (idCol === -1) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(ID_HEADER).setFontWeight("bold");
      idCol = lastCol - 1;
    }

    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    const ids = values.map((row) => [row[idCol] || ""]);
    const leads = [];
    let idsChanged = false;

    values.forEach((row, r) => {
      const lead = {};
      for (const key of Object.keys(FIELDS)) lead[key] = (row[col[key]] || "").trim();
      if (!lead.business_name && !lead.contact_person && !lead.email) return; // blank row
      if (!ids[r][0]) {
        ids[r][0] = Utilities.getUuid();
        idsChanged = true;
      }
      lead.id = ids[r][0];
      leads.push(lead);
    });

    if (idsChanged) sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
    if (leads.length === 0) return { ok: true, message: "No leads to sync." };

    const res = UrlFetchApp.fetch(siteUrl + "/api/leads/import", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + secret },
      payload: JSON.stringify({ leads }),
      muteHttpExceptions: true,
    });
    const body = JSON.parse(res.getContentText() || "{}");
    if (res.getResponseCode() !== 200 || !body.ok) {
      const message = `Sync failed (${res.getResponseCode()}): ${body.error || res.getContentText().slice(0, 200)}`;
      console.error(message);
      return { ok: false, message };
    }

    const message = `Synced ${leads.length} leads: ${body.inserted} new, ${body.updated} updated, ${body.skipped} skipped.`;
    console.log(message);
    return { ok: true, message };
  } finally {
    lock.releaseLock();
  }
}
