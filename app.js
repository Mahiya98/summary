// ====== CONFIG ======
const SPREADSHEET_ID = "17isMrQuxVMbFjsL8sIiB6iwm3xRTr-4gELPxZmPeOTQ";
const GID = "0";

const URLS = [
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`,
];

let allData = [];           // raw rows from sheet
let aggregatedData = [];    // one row per date (after filter + grouping)

// ====== HELPERS ======
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
const fmt2 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
const dateKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "";

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
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`,
        { cache: "no-store", redirect: "follow" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      if (txt.trim().startsWith("<")) throw new Error("Got HTML — sheet not public");
      const parsed = parseCsv(txt);
      if (!parsed.length) throw new Error("Empty CSV");
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
  sel.innerHTML = '<option value="">Select All</option>' +
    values.map(v => `<option value="${v}">${v}</option>`).join("");
  sel.value = cur;
}
function initFilters() {
  const sbuVals = uniqueValues("SBU");
  const sbuField = $("sbuField");
  if (sbuField) sbuField.style.display = sbuVals.length === 0 ? "none" : "";
  fillSelect("filterSBU", sbuVals);
  fillSelect("filterShop",
    uniqueValues("Shop Floor").length ? uniqueValues("Shop Floor") : uniqueValues("Product Criteria"));
  fillSelect("filterMachine", uniqueValues("Mill Name", "Machine", "Machine Name"));
}

// ====== APPLY FILTERS + AGGREGATE BY DATE ======
function applyFilters() {
  const sbu = $("filterSBU")?.value || "";
  const shop = $("filterShop")?.value || "";
  const mach = $("filterMachine")?.value || "";
  const from = parseDate($("fromDate")?.value);
  const to = parseDate($("toDate")?.value);
  if (to) to.setHours(23, 59, 59, 999);

  // Step 1: Filter raw rows
  const filtered = allData.filter(r => {
    if (sbu && getCol(r, "SBU") !== sbu) return false;
    const shopVal = getCol(r, "Shop Floor") || getCol(r, "Product Criteria");
    if (shop && shopVal !== shop) return false;
    if (mach && getCol(r, "Mill Name", "Machine", "Machine Name") !== mach) return false;
    const d = parseDate(getCol(r, "Date"));
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return d !== null; // skip rows with no valid date
  });

  // Step 2: Group by date — key = YYYY-MM-DD so same date never repeats
  const groups = new Map();
  filtered.forEach(r => {
    const d = parseDate(getCol(r, "Date"));
    const key = dateKey(d);
    if (!groups.has(key)) {
      groups.set(key, {
        dateObj: d,
        sumTgt: 0, sumActual: 0, sumGood: 0,
        wWastage: 0, wOee: 0, wNpt: 0, // weighted by actual output
        wTotal: 0,                      // sum of weights (= sum actual)
        // fallback simple averages if actual = 0
        sWastage: 0, sOee: 0, sNpt: 0, sCount: 0,
      });
    }
    const g = groups.get(key);
    const tgt = num(getCol(r, "Shift Target (MT)", "Shift Target", "TGT O/P"));
    const act = num(getCol(r, "Actual Output (MT)", "Actual Output", "ACTUAL O/P"));
    const good = num(getCol(r, "Good Production"));
    const wastage = num(getCol(r, "Wastage%", "Wastage"));
    const oee = num(getCol(r, "OEE%", "OEE"));
    const npt = num(getCol(r, "NPT%", "NPT"));

    g.sumTgt += tgt;
    g.sumActual += act;
    g.sumGood += good;

    if (act > 0) {
      g.wWastage += wastage * act;
      g.wOee += oee * act;
      g.wNpt += npt * act;
      g.wTotal += act;
    }
    // also keep simple counts as fallback
    g.sWastage += wastage; g.sOee += oee; g.sNpt += npt; g.sCount++;
  });

  // Step 3: Build one row per date with computed values
  aggregatedData = [...groups.values()]
    .sort((a, b) => a.dateObj - b.dateObj)
    .map(g => {
      const achiv = g.sumActual > 0 ? (g.sumGood / g.sumActual) * 100 : 0;
      const wastagePct = g.wTotal > 0 ? g.wWastage / g.wTotal : (g.sCount ? g.sWastage / g.sCount : 0);
      const oeePct     = g.wTotal > 0 ? g.wOee     / g.wTotal : (g.sCount ? g.sOee     / g.sCount : 0);
      const nptPct     = g.wTotal > 0 ? g.wNpt     / g.wTotal : (g.sCount ? g.sNpt     / g.sCount : 0);
      return {
        date: fmtDate(g.dateObj),
        dateObj: g.dateObj,
        tgt: g.sumTgt,
        actual: g.sumActual,
        good: g.sumGood,
        achiv,
        wastage: wastagePct,
        oee: oeePct,
        npt: nptPct,
      };
    });

  renderCards();
  renderTable();
}

// ====== RENDER CARDS ======
function renderCards() {
  let totalTgt = 0, totalActual = 0, totalGood = 0;
  let sumAchiv = 0, nAchiv = 0;
  let wOee = 0, wNpt = 0, wTot = 0;
  let sOee = 0, sNpt = 0, sCnt = 0;

  aggregatedData.forEach(d => {
    totalTgt += d.tgt;
    totalActual += d.actual;
    totalGood += d.good;
    if (d.actual > 0) { sumAchiv += d.achiv; nAchiv++; }
    if (d.actual > 0) { wOee += d.oee * d.actual; wNpt += d.npt * d.actual; wTot += d.actual; }
    sOee += d.oee; sNpt += d.npt; sCnt++;
  });

  setText("cTgt", fmt(totalTgt));
  setText("cActual", fmt(totalActual));
  setText("cGood", fmt(totalGood));
  setText("cAchiv", pct(totalActual > 0 ? (totalGood / totalActual) * 100 : 0));
  setText("cOee", pct(wTot > 0 ? wOee / wTot : (sCnt ? sOee / sCnt : 0)));
  setText("cNpt", pct(wTot > 0 ? wNpt / wTot : (sCnt ? sNpt / sCnt : 0)));
  setText("cCount", aggregatedData.length.toLocaleString());
}

// ====== RENDER TABLE — one row per UNIQUE date ======
function renderTable() {
  const table = $("dataTable"); if (!table) return;
  const tbody = table.querySelector("tbody"); if (!tbody) return;

  if (!aggregatedData.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:30px;color:#9ca3af;text-align:center;">No data for selected filters</td></tr>`;
    return;
  }

  tbody.innerHTML = aggregatedData.map(d => `
    <tr>
      <td>${d.date}</td>
      <td>${fmt2(d.tgt)}</td>
      <td>${fmt(d.actual)}</td>
      <td>${fmt(d.good)}</td>
      <td>${d.actual > 0 ? d.achiv.toFixed(2) + "%" : ""}</td>
      <td>${d.wastage ? d.wastage.toFixed(2) + "%" : ""}</td>
      <td>${d.oee ? d.oee.toFixed(2) + "%" : ""}</td>
      <td>${d.npt ? d.npt.toFixed(2) + "%" : ""}</td>
    </tr>
  `).join("");
}

// ====== EXCEL EXPORT (aggregated data) ======
function exportExcel() {
  if (!aggregatedData.length) { alert("No data to export!"); return; }

  const headers = ["Date", "Shift Target (MT)", "Actual Output (MT)", "Good Production",
    "Achiv%", "Wastage%", "OEE%", "NPT%"];

  const rows = aggregatedData.map(d => [
    d.date,
    d.tgt.toFixed(2),
    d.actual.toFixed(0),
    d.good.toFixed(0),
    d.actual > 0 ? d.achiv.toFixed(2) + "%" : "",
    d.wastage ? d.wastage.toFixed(2) + "%" : "",
    d.oee ? d.oee.toFixed(2) + "%" : "",
    d.npt ? d.npt.toFixed(2) + "%" : "",
  ]);

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
    ["filterSBU","filterShop","filterMachine","fromDate","toDate"]
      .forEach(id => { const el = $(id); if (el) el.value = ""; });
    applyFilters();
  });
  $("excelBtn")?.addEventListener("click", exportExcel);

  setInterval(loadData, 5 * 60 * 1000);
  loadData();
});
