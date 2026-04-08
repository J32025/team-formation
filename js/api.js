/**
 * API Connector - Google Apps Script
 * เชื่อมต่อผ่าน Apps Script Web App (exec URL)
 */

const STORAGE_KEY = 'team_mgmt_config';

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

export function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── Fetch data from Apps Script ──
export async function fetchData(apiUrl) {
  const res = await fetch(apiUrl + '?action=getData', { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

// ── Save move/transfer ──
export async function saveTransfer(apiUrl, transfers) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'transfer', transfers }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── Save all data ──
export async function saveAllData(apiUrl, data) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'saveAll', data }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── CSV fallback (public sheet, read-only) ──
export function toCsvUrl(input) {
  const m = input.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gid = (input.match(/[?&]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const NUM = new Set(['id','level','status','lcht_main','lcht_gen','entry_be','birth_be','years_service','years_in_rank']);

  return lines.slice(1).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { vals.push(cur); cur = ''; }
      else cur += c;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => {
      const raw = (vals[i] || '').replace(/^"|"$/g, '').trim();
      obj[h] = NUM.has(h) ? (raw === '' ? null : Number(raw)) : raw;
    });
    return obj;
  }).filter(r => r.id != null);
}

export async function fetchViaCsv(sheetUrl) {
  const csvUrl = toCsvUrl(sheetUrl);
  if (!csvUrl) throw new Error('URL ไม่ถูกต้อง');
  const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(csvUrl)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes('<html')) throw new Error('Sheet ยังไม่ได้แชร์เป็น public');
  return parseCsv(text);
}
