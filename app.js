// ====== CONFIG ======
const SPREADSHEET_ID = "17isMrQuxVMbFjsL8sIiB6iwm3xRTr-4gELPxZmPeOTQ";
const GID = "0"; // change if your data tab has a different gid

const URLS = [
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`,
];

let allData = [];
let filteredData = [];

// ====== HELPERS (null-safe) ======
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
const setStatus = (t) => setText("status", t);

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/[%,\s]/g, ""));
  return isNaN(n) ? 0 : n;
};
const pct = (v) => (isFinite(v) ? v : 0).toFixed(2) + "%";
const fmt = (n) => Math.round(n).toLocaleString();
const normalize = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[%\s_\-\/\.]/g, "").trim();

function getCol(row, ...names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const target = normalize(n);
    for (const k of keys) if (normalize(k) === target) return row[k];
  }
  for (const n of names) {
    const target = normalize(n);
    if (target.length < 4) continue;
    for (const k of keys) if (normalize(k).includes(target)) return row[k];
  }
  return "";
}

function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[1] - 1, +m[2]);
  }
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return isNaN(d) ? null : d;
}
const fmtDate = (d) => d ? `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}` : "";

// ====== CSV PARSER ======
function parseCsv(str) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuotes) {
      if (c === '"' && str[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  let headerIdx = rows.findIndex(r => r.some(c => /^date$/i.test((c||"").trim())));
  if (headerIdx < 0) headerIdx = 0;
  const headers = rows[headerIdx].map(h => (h||"").trim());
  return rows.slice(headerIdx + 1)
    .filter(r => r.some(c => c && String(c).trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").toString().trim()])));
}

// ====== FETCH ======
async function loadData() {
  setStatus("Loading…");
  let lastErr;
  for (const url of URLS) {
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store", redirect: "follow" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      if (txt.trim().startsWith("<")) throw new Error("Got HTML — sheet not public");
      const parsed = parseCsv(txt);
      if (!parsed.length) throw new Error("Empty CSV");

      // Sort data ascending by date so rendered order matches the date range
      parsed.sort((a, b) => {
        const da = parseDate(getCol(a, "Date"));
        const db = parseDate(getCol(b, "Date"));
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da - db;
      });

      allData = parsed;
      console.log(`✅ ${parsed.length} rows. Headers:`, Object.keys(parsed[0]));
      setStatus(`✅ ${parsed.length} rows loaded`);
      initFilters();
      applyFilters();
      return;
    } catch (e) {
      console.warn("❌", url, "→", e.message);
      lastErr = e;
    }
  }
  setStatus("❌ " + (lastErr?.message || "Failed"));
  alert("Cannot load data. Make sure sheet is shared 'Anyone with the link → Viewer'.");
}

// ====== FILTERS ======
function uniqueValues(...names) {
  const set = new Set();
  allData.forEach(r => {
    const v = getCol(r, ...names);
    if (v && String(v).trim() !== "") set.add(String(v).trim());
  });
  return [...set].sort();
}
function fillSelect(id, values) {
  const sel = $(id); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select All</option>' + values.map(v => `<option value="${v}">${v}</option>`).join("");
  sel.value = cur;
}
function initFilters() {
  const sbuVals = uniqueValues("SBU");
  const sbuField = $("sbuField");
  if (sbuField) sbuField.style.display = sbuVals.length === 0 ? "none" : "";
  fillSelect("filterSBU", sbuVals);
  fillSelect("filterShop", uniqueValues("Shop Floor").length ? uniqueValues("Shop Floor") : uniqueValues("Product Criteria"));
  fillSelect("filterMachine", uniqueValues("Mill Name", "Machine", "Machine Name"));
}

// ====== APPLY FILTERS — each row is matched independently to its own Date ======
function applyFilters() {
  const sbu = $("filterSBU")?.value || "";
  const shop = $("filterShop")?.value || "";
  const mach = $("filterMachine")?.value || "";
  const from = parseDate($("fromDate")?.value);
  const to = parseDate($("toDate")?.value);
  if (to) to.setHours(23, 59, 59, 999);

  filteredData = allData.filter(r => {
    if (sbu && getCol(r, "SBU") !== sbu) return false;
    const shopVal = getCol(r, "Shop Floor") || getCol(r, "Product Criteria");
    if (shop && shopVal !== shop) return false;
    if (mach && getCol(r, "Mill Name", "Machine", "Machine Name") !== mach) return false;

    // ✅ Per-row date check — every row carries its own date and other columns
    const d = parseDate(getCol(r, "Date"));
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return true;
  });

  renderCards();
  renderTable();
}

// ====== RENDER CARDS ======
function renderCards() {
  let totalTgt = 0, totalActual = 0, totalGood = 0;
  let sumAchiv = 0, nAchiv = 0, sumOee = 0, nOee = 0, sumNpt = 0, nNpt = 0;

  filteredData.forEach(r => {
    const tgt = num(getCol(r, "Shift Target (MT)", "Shift Target", "TGT O/P"));
    const act = num(getCol(r, "Actual Output (MT)", "Actual Output", "ACTUAL O/P"));
    const good = num(getCol(r, "Good Production"));
    totalTgt += tgt; totalActual += act; totalGood += good;
    if (act > 0) { sumAchiv += (good / act) * 100; nAchiv++; }
    const oee = num(getCol(r, "OEE%", "OEE")); if (oee > 0) { sumOee += oee; nOee++; }
    const nptRaw = getCol(r, "NPT%", "NPT"); if (nptRaw !== "") { sumNpt += num(nptRaw); nNpt++; }
  });

  setText("cTgt", fmt(totalTgt));
  setText("cActual", fmt(totalActual));
  setText("cGood", fmt(totalGood));
  setText("cAchiv", pct(nAchiv ? sumAchiv / nAchiv : 0));
  setText("cOee", pct(nOee ? sumOee / nOee : 0));
  setText("cNpt", pct(nNpt ? sumNpt / nNpt : 0));
  setText("cCount", filteredData.length.toLocaleString());
}

// ====== RENDER TABLE — one row per record with its own Date + matching values ======
function renderTable() {
  const table = $("dataTable"); if (!table) return;
  const tbody = table.querySelector("tbody"); if (!tbody) return;

  if (!filteredData.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="padding:30px;color:#9ca3af;text-align:center;">No data for selected filters</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredData.map(r => {
    const dateStr = getCol(r, "Date");                                    // ⬅ each row's own date
    const tgt = num(getCol(r, "Shift Target (MT)", "TGT O/P"));
    const act = num(getCol(r, "Actual Output (MT)", "ACTUAL O/P"));
    const good = num(getCol(r, "Good Production"));
    const achiv = act > 0 ? (good / act) * 100 : 0;                       // ⬅ G/F formula
    return `<tr>
      <td class="date-cell">${dateStr || ""}</td>
      <td>${getCol(r, "Product Criteria", "Item Name") || ""}</td>
      <td>${getCol(r, "Shift") || ""}</td>
      <td>${getCol(r, "Mill Name", "Machine") || ""}</td>
      <td>${tgt ? fmt(tgt) : ""}</td>
      <td>${act ? fmt(act) : ""}</td>
      <td>${good ? good.toFixed(2) : ""}</td>
      <td>${act > 0 ? achiv.toFixed(2) + "%" : ""}</td>
      <td>${getCol(r, "Wastage%", "Wastage") || ""}</td>
      <td>${getCol(r, "OEE%", "OEE") || ""}</td>
      <td>${getCol(r, "NPT%", "NPT") || ""}</td>
    </tr>`;
  }).join("");
}

// ====== EXCEL EXPORT (filtered data only) ======
function exportExcel() {
  if (!filteredData.length) { alert("No data to export!"); return; }

  const headers = ["Date","Product Criteria","Shift","Mill Name","TGT O/P","Actual O/P",
    "Good Production","Achiv%","Wastage%","OEE%","NPT%"];

  const rows = filteredData.map(r => {
    const act = num(getCol(r, "Actual Output (MT)", "ACTUAL O/P"));
    const good = num(getCol(r, "Good Production"));
    const achiv = act > 0 ? ((good / act) * 100).toFixed(2) + "%" : "";
    return [
      getCol(r, "Date"),
      getCol(r, "Product Criteria"),
      getCol(r, "Shift"),
      getCol(r, "Mill Name"),
      getCol(r, "Shift Target (MT)", "TGT O/P"),
      getCol(r, "Actual Output (MT)", "ACTUAL O/P"),
      getCol(r, "Good Production"),
      achiv,
      getCol(r, "Wastage%"),
      getCol(r, "OEE%"),
      getCol(r, "NPT%"),
    ];
  });

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"></head>
    <body><table border="1">
      <tr style="background:#1e3a8a;color:#fff;font-weight:bold">${headers.map(h=>`<th>${h}</th>`).join("")}</tr>
      ${rows.map(r => `<tr>${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}
    </table></body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Production_Dashboard_${new Date().toISOString().slice(0,10)}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ====== EVENTS ======
document.addEventListener("DOMContentLoaded", () => {
  ["filterSBU","filterShop","filterMachine","fromDate","toDate"]
    .forEach(id => { const el = $(id); if (el) el.addEventListener("change", applyFilters); });

  $("resetBtn")?.addEventListener("click", () => {
    ["filterSBU","filterShop","filterMachine","fromDate","toDate"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    applyFilters();
  });
  $("excelBtn")?.addEventListener("click", exportExcel);

  setInterval(loadData, 5 * 60 * 1000);
  loadData();
});
