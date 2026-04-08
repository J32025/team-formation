import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { loadConfig, saveConfig, fetchData, saveTransfer, fetchViaCsv, getApiUrl } from './api.js';

const html = htm.bind(React.createElement);

// ══════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════

const STATUS_MAP = {
  1: { label: 'บรรจุจริง', cls: 'filled', color: '#22c55e' },
  0: { label: 'ว่าง', cls: 'vacant', color: '#f59e0b' },
  3: { label: 'ปิด', cls: 'closed', color: '#ef4444' },
  7: { label: 'ประจำ', cls: 'reserve', color: '#a855f7' },
  5: { label: 'รรก.', cls: 'acting', color: '#3b82f6' },
  8: { label: 'ทำหน้าที่โดย ต.', cls: 'other', color: '#94a3b8' },
  4: { label: 'ทำหน้าที่', cls: 'other', color: '#94a3b8' },
};

const getStatus = (s) => STATUS_MAP[s] || { label: s || '-', cls: 'other', color: '#94a3b8' };

const RANK_ORDER = {
  'พล.อ.': 1, 'พล.ท.': 2, 'พล.ต.': 3,
  'พล.ร.อ.': 1, 'พล.ร.ท.': 2, 'พล.ร.ต.': 3,
  'พล.อ.อ.': 1, 'พล.อ.ท.': 2, 'พล.อ.ต.': 3,
  'พ.อ.(พ)': 4, 'พ.อ.': 5, 'พ.ท.': 6, 'พ.ต.': 7,
  'น.อ.': 5, 'น.ท.': 6, 'น.ต.': 7,
  'ร.อ.': 8, 'ร.ท.': 9, 'ร.ต.': 10,
  'จ.ส.อ.(พ)': 11, 'จ.ส.อ.': 12, 'จ.ส.ท.': 13, 'จ.ส.ต.': 14,
  'ส.อ.': 15, 'ส.ท.': 16, 'ส.ต.': 17,
};

const LEVEL_GROUPS = [
  { label: 'ผู้บังคับบัญชา', levels: [3, 4], icon: '⭐' },
  { label: 'อำนวยการ', levels: [5, 6], icon: '🎯' },
  { label: 'ปฏิบัติการ (สัญญาบัตร)', levels: [7, 8, 9, 10], icon: '📋' },
  { label: 'ปฏิบัติการ (ประทวน)', levels: [19, 21, 22, 25, 29], icon: '🔧' },
];

const PER_PAGE = 30;

// ══════════════════════════════════════════════════════
//  DEMO DATA
// ══════════════════════════════════════════════════════

const DEMO_DATA = null; // Will load from API or local

// ══════════════════════════════════════════════════════
//  TOAST COMPONENT
// ══════════════════════════════════════════════════════

function Toasts({ toasts }) {
  if (!toasts.length) return null;
  return html`
    <div class="toast-container">
      ${toasts.map((t, i) => html`<div key=${i} class="toast ${t.type}">${t.msg}</div>`)}
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  STAT CARDS
// ══════════════════════════════════════════════════════

function StatsBar({ data }) {
  const stats = useMemo(() => {
    const total = data.length;
    const filled = data.filter(d => d.status === 1).length;
    const vacant = data.filter(d => d.status === 0).length;
    const closed = data.filter(d => d.status === 3).length;
    const acting = data.filter(d => d.status === 5 || d.status === 4).length;
    const reserve = data.filter(d => d.status === 7).length;
    return { total, filled, vacant, closed, acting, reserve };
  }, [data]);

  return html`
    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="label">ตำแหน่งทั้งหมด</div>
        <div class="value">${stats.total}</div>
        <div class="sub">อัตรากำลัง</div>
      </div>
      <div class="stat-card green">
        <div class="label">บรรจุจริง (ตัวจริง)</div>
        <div class="value">${stats.filled}</div>
        <div class="sub">${(stats.filled / stats.total * 100).toFixed(1)}% ของทั้งหมด</div>
      </div>
      <div class="stat-card amber">
        <div class="label">ว่าง</div>
        <div class="value">${stats.vacant}</div>
        <div class="sub">รอบรรจุ</div>
      </div>
      <div class="stat-card red">
        <div class="label">ปิด</div>
        <div class="value">${stats.closed}</div>
        <div class="sub">ไม่เปิดใช้</div>
      </div>
      <div class="stat-card purple">
        <div class="label">ตัวสำรอง (ประจำ)</div>
        <div class="value">${stats.reserve}</div>
        <div class="sub">รอปรับย้าย</div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  PHOTO STORAGE (localStorage)
// ══════════════════════════════════════════════════════

const PHOTO_KEY = 'team_mgmt_photos';

function loadPhotos() {
  try { return JSON.parse(localStorage.getItem(PHOTO_KEY)) || {}; } catch { return {}; }
}

function savePhoto(personId, dataUrl) {
  const photos = loadPhotos();
  photos[personId] = dataUrl;
  localStorage.setItem(PHOTO_KEY, JSON.stringify(photos));
}

function getPhoto(personId) {
  return loadPhotos()[personId] || null;
}

// ══════════════════════════════════════════════════════
//  AVATAR COMPONENT (with photo)
// ══════════════════════════════════════════════════════

function Avatar({ person, size = 40, showUpload = false, onPhotoChange }) {
  const photo = person?.person_id ? getPhoto(String(person.person_id)) : null;
  const st = getStatus(person?.status);
  const initial = (person?.name || '?').charAt(0);
  const fileRef = useRef(null);

  const bgStyle = photo ? {} : { background: st.color || 'var(--accent)' };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Resize to 100x100 for storage
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100; canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, 100, 100);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        savePhoto(String(person.person_id), dataUrl);
        if (onPhotoChange) onPhotoChange();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  return html`
    <div class="p-avatar" style=${{ width: size, height: size, fontSize: size * 0.35, ...bgStyle }}>
      ${photo
        ? html`<img src=${photo} alt="" />`
        : initial}
      ${showUpload && person?.person_id ? html`
        <div class="photo-upload" onClick=${(e) => { e.stopPropagation(); fileRef.current?.click(); }}>📷</div>
        <input ref=${fileRef} class="photo-input" type="file" accept="image/*" onChange=${handleFile} />
      ` : null}
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  ORG TREE HELPERS
// ══════════════════════════════════════════════════════

const DEPT_NAMES = {
  '40900': { name: 'กรมยุทธการทหาร (ส่วนบังคับบัญชา)', short: 'บก.ยก.ทหาร' },
  '40901': { name: 'กองกลาง', short: 'กกล.' },
  '40902': { name: 'กองแผนและงบประมาณ', short: 'กผง.' },
  '40903': { name: 'กองการเงิน', short: 'กกง.' },
  '40904': { name: 'กองกรรมวิธีข้อมูล', short: 'กกม.' },
  '40905': { name: 'สำนักนโยบายและแผน', short: 'สนผ.' },
  '40906': { name: 'สำนักปฏิบัติการ', short: 'สปก.' },
  '40907': { name: 'สำนักวางแผนฝึกร่วมและผสม', short: 'สวฝ.' },
  '40908': { name: 'ศูนย์สันติภาพ', short: 'ศสภ.' },
  '40909': { name: 'สำนักงาน ปรมน.', short: 'สง.ปรมน.' },
};

function buildOrgTree(data) {
  const depts = {};
  for (const d of data) {
    const code = String(d.pos_code || '');
    const deptCode = code.slice(0, 5);
    const secCode = code.slice(0, 8);
    if (!deptCode) continue;
    if (!depts[deptCode]) depts[deptCode] = { code: deptCode, sections: {}, all: [] };
    depts[deptCode].all.push(d);
    if (!depts[deptCode].sections[secCode]) depts[deptCode].sections[secCode] = [];
    depts[deptCode].sections[secCode].push(d);
  }

  return Object.keys(depts).sort().map(dc => {
    const dept = depts[dc];
    const filled = dept.all.filter(d => d.status === 1);
    const vacant = dept.all.filter(d => d.status === 0);
    const head = filled.reduce((best, d) => (!best || d.level < best.level) ? d : best, null);
    const info = DEPT_NAMES[dc] || { name: dc, short: dc };

    const sections = Object.keys(dept.sections).sort().map(sc => {
      const items = dept.sections[sc];
      const secFilled = items.filter(d => d.status === 1);
      const secVacant = items.filter(d => d.status === 0);
      const secHead = secFilled.reduce((b, d) => (!b || d.level < b.level) ? d : b, null);
      return { code: sc, items, filled: secFilled, vacant: secVacant, head: secHead };
    });

    return { code: dc, ...info, all: dept.all, filled, vacant, head, sections };
  });
}

// ══════════════════════════════════════════════════════
//  ORG TREE VIEW (replaces FieldView)
// ══════════════════════════════════════════════════════

function OrgTreeView({ data, onSelect }) {
  const [openDepts, setOpenDepts] = useState({});
  const [openSections, setOpenSections] = useState({});
  const [showVacant, setShowVacant] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);

  const tree = useMemo(() => buildOrgTree(data), [data]);

  const toggleDept = (code) => setOpenDepts(prev => ({ ...prev, [code]: !prev[code] }));
  const toggleSection = (code) => setOpenSections(prev => ({ ...prev, [code]: !prev[code] }));

  const expandAll = () => {
    const d = {}, s = {};
    tree.forEach(dept => { d[dept.code] = true; dept.sections.forEach(sec => { s[sec.code] = true; }); });
    setOpenDepts(d); setOpenSections(s);
  };
  const collapseAll = () => { setOpenDepts({}); setOpenSections({}); };

  return html`
    <div>
      <div class="tree-controls">
        <button class="ctrl-btn" onClick=${expandAll}>▶ ขยายทั้งหมด</button>
        <button class="ctrl-btn" onClick=${collapseAll}>◀ ยุบทั้งหมด</button>
        <button class="ctrl-btn ${showVacant ? 'active' : ''}" onClick=${() => setShowVacant(v => !v)}>
          ${showVacant ? '● แสดงตำแหน่งว่าง' : '○ ซ่อนตำแหน่งว่าง'}
        </button>
        <span style=${{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
          ${tree.length} หน่วย | ${data.filter(d => d.status === 1).length} คนบรรจุจริง
        </span>
      </div>

      <div class="org-tree">
        ${tree.map(dept => html`
          <div key=${dept.code} class="dept-card">
            <!-- Department Header -->
            <div class="dept-header" onClick=${() => toggleDept(dept.code)}>
              <div class="dept-toggle ${openDepts[dept.code] ? 'open' : ''}">▶</div>
              <${Avatar} person=${dept.head} size=${48} showUpload=${true} onPhotoChange=${() => setPhotoVer(v => v + 1)} />
              <div class="dept-info">
                <div class="dept-name">${dept.name}</div>
                <div class="dept-meta">
                  <span>${dept.head?.name || '(ว่าง)'}</span>
                  <span>|</span>
                  <span>${dept.sections.length} หน่วยย่อย</span>
                </div>
              </div>
              <div class="dept-stats">
                <span class="dept-stat-pill filled">${dept.filled.length} คน</span>
                <span class="dept-stat-pill vacant">${dept.vacant.length} ว่าง</span>
                <div class="fill-bar">
                  <div class="fill-bar-inner" style=${{ width: `${(dept.filled.length / dept.all.length * 100)}%` }}></div>
                </div>
              </div>
            </div>

            <!-- Sections (expanded) -->
            ${openDepts[dept.code] ? html`
              <div class="dept-body">
                ${dept.sections.map(sec => html`
                  <div key=${sec.code} class="section-card">
                    <div class="section-header" onClick=${() => toggleSection(sec.code)}>
                      <div class="section-toggle ${openSections[sec.code] ? 'open' : ''}">▶</div>
                      <${Avatar} person=${sec.head} size=${32} />
                      <div class="section-info">
                        <div class="section-name">${sec.head?.position || sec.code}</div>
                        <div class="section-meta">${sec.filled.length}/${sec.items.length} ตำแหน่ง</div>
                      </div>
                      <div class="dept-stats">
                        <span class="dept-stat-pill filled" style=${{ fontSize: 10, padding: '2px 8px' }}>${sec.filled.length}</span>
                        ${sec.vacant.length > 0 ? html`
                          <span class="dept-stat-pill vacant" style=${{ fontSize: 10, padding: '2px 8px' }}>${sec.vacant.length}</span>
                        ` : null}
                      </div>
                    </div>

                    ${openSections[sec.code] ? html`
                      <div class="person-grid">
                        ${sec.filled.sort((a, b) => a.level - b.level || a.id - b.id).map(p => html`
                          <div key=${p.id} class="person-card" onClick=${() => onSelect(p)}>
                            <${Avatar} person=${p} size=${40} showUpload=${true} onPhotoChange=${() => setPhotoVer(v => v + 1)} />
                            <div class="p-info">
                              <div class="p-name">${p.name}</div>
                              <div class="p-role">${p.rank_req} | ${truncate(p.position, 16)}</div>
                            </div>
                            <div class="p-status-dot" style=${{ background: '#22c55e' }}></div>
                          </div>
                        `)}
                        ${showVacant ? sec.vacant.map(p => html`
                          <div key=${p.id} class="person-card vacant-card" onClick=${() => onSelect(p)}>
                            <div class="p-avatar" style=${{ width: 40, height: 40, background: 'var(--border)', fontSize: 14 }}>?</div>
                            <div class="p-info">
                              <div class="p-name" style=${{ color: 'var(--amber)' }}>ว่าง</div>
                              <div class="p-role">${p.rank_req} | ${truncate(p.position, 16)}</div>
                            </div>
                            <div class="p-status-dot" style=${{ background: 'var(--amber)' }}></div>
                          </div>
                        `) : null}
                      </div>
                    ` : null}
                  </div>
                `)}
              </div>
            ` : null}
          </div>
        `)}
      </div>
    </div>
  `;
}

// (Legacy FieldView removed - replaced by OrgTreeView above)
function FieldView({ data, onSelect }) {
  const groups = useMemo(() => {
    return LEVEL_GROUPS.map(g => ({
      ...g,
      people: data.filter(d => g.levels.includes(d.level) && d.status === 1),
      vacants: data.filter(d => g.levels.includes(d.level) && d.status === 0),
    }));
  }, [data]);

  return html`
    <div class="field-container">
      <div class="field-header">
        <h2>สนามจัดทีม - Formation View</h2>
        <div style=${{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--text-dim)' }}>
          <span style=${{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style=${{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span> ตัวจริง
          </span>
          <span style=${{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style=${{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}></span> ว่าง
          </span>
          <span style=${{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style=${{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', display: 'inline-block' }}></span> สำรอง
          </span>
        </div>
      </div>
      <div class="field-pitch">
        <div class="field-rows">
          ${groups.map((g, gi) => html`
            <div key=${gi}>
              <div class="field-row-label">${g.icon} ${g.label} (${g.people.length} / ${g.people.length + g.vacants.length})</div>
              <div class="field-row">
                ${g.people.slice(0, 12).map(p => html`
                  <div key=${p.id} class="player-node" onClick=${() => onSelect(p)}>
                    <div class="player-avatar filled">${(p.name || '?').charAt(0)}</div>
                    <div class="player-name">${truncate(p.name, 16)}</div>
                    <div class="player-position">${truncate(p.position, 18)}</div>
                  </div>
                `)}
                ${g.vacants.slice(0, 4).map(p => html`
                  <div key=${p.id} class="player-node" onClick=${() => onSelect(p)}>
                    <div class="player-avatar vacant">?</div>
                    <div class="player-name" style=${{ color: 'rgba(255,255,255,0.5)' }}>ว่าง</div>
                    <div class="player-position">${truncate(p.position, 18)}</div>
                  </div>
                `)}
                ${g.people.length + g.vacants.length > 16 ? html`
                  <div class="player-node" style=${{ opacity: 0.5 }}>
                    <div class="player-avatar filled" style=${{ fontSize: 11 }}>+${g.people.length + g.vacants.length - 16}</div>
                    <div class="player-name">อื่นๆ</div>
                  </div>
                ` : null}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function truncate(str, len) {
  if (!str) return '-';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ══════════════════════════════════════════════════════
//  DATA TABLE
// ══════════════════════════════════════════════════════

function DataTable({ data, onSelect, searchText, setSearchText, filterStatus, setFilterStatus, filterLevel, setFilterLevel }) {
  const [sortKey, setSortKey] = useState('id');
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(1);

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
    setPage(1);
  }, [sortKey]);

  const filtered = useMemo(() => {
    let arr = [...data];
    if (searchText) {
      const q = searchText.toLowerCase();
      arr = arr.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.position || '').toLowerCase().includes(q) ||
        (d.pos_code || '').toLowerCase().includes(q) ||
        (d.rank_req || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== '') arr = arr.filter(d => d.status === Number(filterStatus));
    if (filterLevel !== '') arr = arr.filter(d => d.level === Number(filterLevel));

    arr.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb), 'th') * sortDir;
    });
    return arr;
  }, [data, searchText, filterStatus, filterLevel, sortKey, sortDir]);

  useEffect(() => setPage(1), [searchText, filterStatus, filterLevel]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const levels = useMemo(() => [...new Set(data.map(d => d.level))].sort((a, b) => a - b), [data]);

  const TH = ({ k, children }) => html`
    <th class=${sortKey === k ? 'sorted' : ''} onClick=${() => handleSort(k)}>
      ${children}${sortKey === k ? html`<span class="sort-arrow">${sortDir === 1 ? '▲' : '▼'}</span>` : ''}
    </th>
  `;

  return html`
    <div class="table-container">
      <div class="table-toolbar">
        <input class="search-box" placeholder="ค้นหาชื่อ, ตำแหน่ง, รหัส..." value=${searchText} onInput=${e => setSearchText(e.target.value)} />
        <select class="filter-select" value=${filterStatus} onChange=${e => setFilterStatus(e.target.value)}>
          <option value="">สถานะทั้งหมด</option>
          <option value="1">บรรจุจริง</option>
          <option value="0">ว่าง</option>
          <option value="3">ปิด</option>
          <option value="7">ประจำ</option>
          <option value="5">รรก.</option>
        </select>
        <select class="filter-select" value=${filterLevel} onChange=${e => setFilterLevel(e.target.value)}>
          <option value="">ระดับทั้งหมด</option>
          ${levels.map(l => html`<option key=${l} value=${l}>ระดับ ${l}</option>`)}
        </select>
        <span style=${{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: 'auto' }}>
          พบ ${filtered.length} รายการ
        </span>
      </div>
      <div style=${{ overflowX: 'auto' }}>
        <table class="data-table">
          <thead>
            <tr>
              <${TH} k="id">#<//>
              <${TH} k="position">ตำแหน่ง<//>
              <${TH} k="rank_req">ชั้นยศ<//>
              <${TH} k="name">ชื่อ-สกุล<//>
              <${TH} k="status">สถานะ<//>
              <${TH} k="level">ระดับ<//>
              <${TH} k="origin">ที่มา<//>
              <${TH} k="years_service">อายุราชการ<//>
              <${TH} k="years_in_rank">อายุยศ<//>
            </tr>
          </thead>
          <tbody>
            ${paged.map(d => {
              const st = getStatus(d.status);
              return html`
                <tr key=${d.id} onClick=${() => onSelect(d)} style=${{ cursor: 'pointer' }}>
                  <td>${d.id}</td>
                  <td style=${{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>${d.position}</td>
                  <td>${d.rank_req || '-'}</td>
                  <td style=${{ fontWeight: 500 }}>${d.name || html`<span style=${{ color: 'var(--text-muted)' }}>-</span>`}</td>
                  <td><span class="status-badge ${st.cls}"><span class="status-dot"></span>${st.label}</span></td>
                  <td>${d.level}</td>
                  <td>${d.origin || '-'}</td>
                  <td>${d.years_service ?? '-'}</td>
                  <td>${d.years_in_rank ?? '-'}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? html`
        <div class="pagination">
          <button class="page-btn" disabled=${page <= 1} onClick=${() => setPage(p => p - 1)}>◀</button>
          ${Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return html`<button key=${p} class="page-btn ${page === p ? 'active' : ''}" onClick=${() => setPage(p)}>${p}</button>`;
          })}
          <button class="page-btn" disabled=${page >= totalPages} onClick=${() => setPage(p => p + 1)}>▶</button>
          <span class="page-info">หน้า ${page}/${totalPages}</span>
        </div>
      ` : null}
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  DETAIL MODAL
// ══════════════════════════════════════════════════════

function DetailModal({ person, onClose }) {
  if (!person) return null;
  const st = getStatus(person.status);

  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal-content">
        <div class="modal-header">
          <h2>รายละเอียดตำแหน่ง</h2>
          <button class="modal-close" onClick=${onClose}>×</button>
        </div>
        <div class="modal-body">
          <div style=${{ textAlign: 'center', marginBottom: 20 }}>
            <div class="player-avatar ${st.cls}" style=${{ width: 64, height: 64, fontSize: 24, margin: '0 auto', borderWidth: 3 }}>
              ${(person.name || '?').charAt(0)}
            </div>
            <h3 style=${{ marginTop: 12 }}>${person.name || '(ว่าง)'}</h3>
            <div style=${{ color: 'var(--text-dim)', fontSize: 13 }}>${person.position}</div>
            <span class="status-badge ${st.cls}" style=${{ marginTop: 8, display: 'inline-flex' }}>
              <span class="status-dot"></span>${st.label}
            </span>
          </div>
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">รหัสตำแหน่ง</div><div class="detail-value">${person.pos_code || '-'}</div></div>
            <div class="detail-item"><div class="detail-label">ชั้นยศที่ต้องการ</div><div class="detail-value">${person.rank_req || '-'}</div></div>
            <div class="detail-item"><div class="detail-label">ระดับ</div><div class="detail-value">${person.level}</div></div>
            <div class="detail-item"><div class="detail-label">สายงาน</div><div class="detail-value">${person.branch || '-'}</div></div>
            <div class="detail-item full"><div class="detail-label">รายละเอียดตำแหน่ง</div><div class="detail-value" style=${{ whiteSpace: 'normal', lineHeight: 1.5 }}>${person.position_detail || '-'}</div></div>
            ${person.name ? html`
              <div class="detail-item"><div class="detail-label">ที่มา</div><div class="detail-value">${person.origin || '-'}</div></div>
              <div class="detail-item"><div class="detail-label">เหล่า</div><div class="detail-value">${person.corps || '-'}</div></div>
              <div class="detail-item"><div class="detail-label">การศึกษา</div><div class="detail-value">${person.education || '-'}</div></div>
              <div class="detail-item"><div class="detail-label">ลชท.หลัก</div><div class="detail-value">${person.lcht_main ?? '-'}</div></div>
              <div class="detail-item"><div class="detail-label">ลชท.ทั่วไป</div><div class="detail-value">${person.lcht_gen ?? '-'}</div></div>
              <div class="detail-item"><div class="detail-label">เข้ารับราชการ (พ.ศ.)</div><div class="detail-value">${person.entry_be ?? '-'}</div></div>
              <div class="detail-item"><div class="detail-label">อายุราชการ (ปี)</div><div class="detail-value">${person.years_service ?? '-'}</div></div>
              <div class="detail-item"><div class="detail-label">ปีเกิด (พ.ศ.)</div><div class="detail-value">${person.birth_be ?? '-'}</div></div>
              <div class="detail-item"><div class="detail-label">อายุยศ (ปี)</div><div class="detail-value">${person.years_in_rank ?? '-'}</div></div>
            ` : null}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  FORMATION (STARTERS + BENCH) VIEW
// ══════════════════════════════════════════════════════

function FormationView({ data, onDataChange, onSelect, addToast }) {
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [dragPerson, setDragPerson] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [searchBench, setSearchBench] = useState('');

  const group = LEVEL_GROUPS[selectedGroup];
  const starters = useMemo(() =>
    data.filter(d => group.levels.includes(d.level) && d.status === 1)
      .sort((a, b) => (a.id - b.id)),
    [data, selectedGroup]
  );

  const vacants = useMemo(() =>
    data.filter(d => group.levels.includes(d.level) && d.status === 0)
      .sort((a, b) => (a.id - b.id)),
    [data, selectedGroup]
  );

  const bench = useMemo(() => {
    let b = data.filter(d => d.status === 7 || d.status === 5);
    if (searchBench) {
      const q = searchBench.toLowerCase();
      b = b.filter(d => (d.name || '').toLowerCase().includes(q));
    }
    return b;
  }, [data, searchBench]);

  const handleDragStart = (person) => setDragPerson(person);

  const handleDrop = (targetSlot) => {
    if (!dragPerson || !targetSlot) return;
    if (targetSlot.status !== 0) {
      addToast('ตำแหน่งนี้ไม่ว่าง ไม่สามารถย้ายได้', 'error');
      setDragPerson(null);
      setDropTarget(null);
      return;
    }

    const newData = data.map(d => {
      if (d.id === targetSlot.id) {
        return { ...d, status: 1, name: dragPerson.name, person_id: dragPerson.person_id,
          origin: dragPerson.origin, corps: dragPerson.corps, education: dragPerson.education,
          lcht_main: dragPerson.lcht_main, lcht_gen: dragPerson.lcht_gen,
          entry_be: dragPerson.entry_be, years_service: dragPerson.years_service,
          birth_be: dragPerson.birth_be, years_in_rank: dragPerson.years_in_rank,
          position_detail: dragPerson.position_detail,
          status_text: 'บรรจุจริง' };
      }
      if (d.id === dragPerson.id) {
        return { ...d, status: 0, name: '', person_id: null,
          origin: '', corps: '', education: '',
          lcht_main: null, lcht_gen: null,
          entry_be: null, years_service: null,
          birth_be: null, years_in_rank: null,
          position_detail: '',
          status_text: 'ว่าง' };
      }
      return d;
    });

    onDataChange(newData);
    addToast(`ย้าย ${dragPerson.name} ไปตำแหน่ง ${targetSlot.position} สำเร็จ`, 'success');
    setDragPerson(null);
    setDropTarget(null);
  };

  const handleSwap = (personA, personB) => {
    if (!personA || !personB) return;
    const newData = data.map(d => {
      if (d.id === personA.id) {
        return { ...d, name: personB.name, person_id: personB.person_id,
          status: personB.status, status_text: personB.status_text,
          origin: personB.origin, corps: personB.corps, education: personB.education,
          lcht_main: personB.lcht_main, lcht_gen: personB.lcht_gen,
          entry_be: personB.entry_be, years_service: personB.years_service,
          birth_be: personB.birth_be, years_in_rank: personB.years_in_rank,
          position_detail: personB.position_detail };
      }
      if (d.id === personB.id) {
        return { ...d, name: personA.name, person_id: personA.person_id,
          status: personA.status, status_text: personA.status_text,
          origin: personA.origin, corps: personA.corps, education: personA.education,
          lcht_main: personA.lcht_main, lcht_gen: personA.lcht_gen,
          entry_be: personA.entry_be, years_service: personA.years_service,
          birth_be: personA.birth_be, years_in_rank: personA.years_in_rank,
          position_detail: personA.position_detail };
      }
      return d;
    });
    onDataChange(newData);
    addToast(`สลับ ${personA.name} <-> ${personB.name} สำเร็จ`, 'success');
  };

  return html`
    <div class="formation-layout">
      <!-- Left: Starters -->
      <div>
        <div style=${{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          ${LEVEL_GROUPS.map((g, i) => html`
            <button key=${i} class="nav-tab ${selectedGroup === i ? 'active' : ''}"
              onClick=${() => setSelectedGroup(i)}>
              ${g.icon} ${g.label}
            </button>
          `)}
        </div>

        <div class="formation-panel">
          <div class="panel-header">
            <h3>ตัวจริง - ${group.label} (${starters.length})</h3>
            <span style=${{ fontSize: 12, color: 'var(--text-dim)' }}>ว่าง: ${vacants.length}</span>
          </div>
          <div class="panel-body">
            <div class="slot-list">
              ${starters.map(p => html`
                <div key=${p.id} class="position-slot" onClick=${() => onSelect(p)}>
                  <div class="slot-avatar" style=${{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
                    ${(p.name || '?').charAt(0)}
                  </div>
                  <div class="slot-info">
                    <div class="slot-title">${p.name}</div>
                    <div class="slot-sub">${p.position} | ${p.rank_req}</div>
                  </div>
                  <div class="slot-actions">
                    <button class="slot-btn" onClick=${e => { e.stopPropagation(); onSelect(p); }}>ดู</button>
                  </div>
                </div>
              `)}
              ${vacants.map(p => html`
                <div key=${p.id}
                  class="position-slot ${dropTarget === p.id ? 'drop-target' : ''}"
                  onClick=${() => onSelect(p)}
                  onDragOver=${e => { e.preventDefault(); setDropTarget(p.id); }}
                  onDragLeave=${() => setDropTarget(null)}
                  onDrop=${e => { e.preventDefault(); handleDrop(p); }}>
                  <div class="slot-avatar" style=${{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', borderStyle: 'dashed', border: '2px dashed rgba(255,255,255,0.3)' }}>?</div>
                  <div class="slot-info">
                    <div class="slot-title" style=${{ color: 'var(--amber)' }}>ว่าง</div>
                    <div class="slot-sub">${p.position} | ${p.rank_req}</div>
                  </div>
                  <span class="status-badge vacant" style=${{ fontSize: 10 }}>รอบรรจุ</span>
                </div>
              `)}
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Bench -->
      <div class="formation-panel">
        <div class="panel-header">
          <h3>ตัวสำรอง (${bench.length})</h3>
        </div>
        <div style=${{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <input class="search-box" style=${{ width: '100%' }} placeholder="ค้นหาตัวสำรอง..."
            value=${searchBench} onInput=${e => setSearchBench(e.target.value)} />
        </div>
        <div class="panel-body">
          <div class="bench-section">
            <div class="bench-header">ประจำ / รรก. - ลากไปวางที่ตำแหน่งว่าง</div>
            ${bench.map(p => {
              const st = getStatus(p.status);
              return html`
                <div key=${p.id} class="bench-person"
                  draggable="true"
                  onDragStart=${() => handleDragStart(p)}
                  onDragEnd=${() => { setDragPerson(null); setDropTarget(null); }}
                  onClick=${() => onSelect(p)}>
                  <div class="mini-avatar" style=${{ background: st.color }}>${(p.name || '?').charAt(0)}</div>
                  <div class="person-info">
                    <div class="person-name">${p.name || '-'}</div>
                    <div class="person-meta">${p.position} | ${p.rank_req} | อายุราชการ ${p.years_service ?? '-'} ปี</div>
                  </div>
                  <span class="status-badge ${st.cls}" style=${{ fontSize: 10 }}>${st.label}</span>
                </div>
              `;
            })}
            ${bench.length === 0 ? html`<div class="empty-state">ไม่พบตัวสำรอง</div>` : null}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  CONDITION FILTER VIEW
// ══════════════════════════════════════════════════════

function ConditionView({ data, onSelect }) {
  const [rank, setRank] = useState('');
  const [minService, setMinService] = useState('');
  const [maxService, setMaxService] = useState('');
  const [minRankAge, setMinRankAge] = useState('');
  const [origin, setOrigin] = useState('');
  const [education, setEducation] = useState('');
  const [branch, setBranch] = useState('');
  const [lcht, setLcht] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(true);

  const origins = useMemo(() => [...new Set(data.map(d => d.origin).filter(Boolean))].sort(), [data]);
  const educations = useMemo(() => [...new Set(data.map(d => d.education).filter(Boolean))].sort(), [data]);
  const ranks = useMemo(() => [...new Set(data.map(d => d.rank_req).filter(Boolean))].sort(), [data]);

  const results = useMemo(() => {
    let arr = [...data];
    if (onlyFilled) arr = arr.filter(d => d.status === 1 || d.status === 7 || d.status === 5);
    if (rank) arr = arr.filter(d => d.rank_req === rank);
    if (minService) arr = arr.filter(d => (d.years_service ?? 0) >= Number(minService));
    if (maxService) arr = arr.filter(d => (d.years_service ?? 999) <= Number(maxService));
    if (minRankAge) arr = arr.filter(d => (d.years_in_rank ?? 0) >= Number(minRankAge));
    if (origin) arr = arr.filter(d => d.origin === origin);
    if (education) arr = arr.filter(d => d.education === education);
    if (branch) arr = arr.filter(d => (d.branch || '').includes(branch));
    if (lcht) arr = arr.filter(d => d.lcht_main != null && String(d.lcht_main).includes(lcht));
    return arr;
  }, [data, rank, minService, maxService, minRankAge, origin, education, branch, lcht, onlyFilled]);

  return html`
    <div>
      <div class="condition-panel">
        <h3 style=${{ fontSize: 16, fontWeight: 600 }}>กรองตามเงื่อนไข</h3>
        <p style=${{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          ค้นหากำลังพลตามเงื่อนไขที่กำหนด เพื่อจัดสรรตำแหน่งได้อย่างเหมาะสม
        </p>
        <div class="condition-grid">
          <div class="condition-field">
            <label>ชั้นยศ</label>
            <select value=${rank} onChange=${e => setRank(e.target.value)}>
              <option value="">ทั้งหมด</option>
              ${ranks.map(r => html`<option key=${r} value=${r}>${r}</option>`)}
            </select>
          </div>
          <div class="condition-field">
            <label>อายุราชการ (ขั้นต่ำ ปี)</label>
            <input type="number" placeholder="เช่น 30" value=${minService} onInput=${e => setMinService(e.target.value)} />
          </div>
          <div class="condition-field">
            <label>อายุราชการ (สูงสุด ปี)</label>
            <input type="number" placeholder="เช่น 40" value=${maxService} onInput=${e => setMaxService(e.target.value)} />
          </div>
          <div class="condition-field">
            <label>อายุยศ (ขั้นต่ำ ปี)</label>
            <input type="number" placeholder="เช่น 5" value=${minRankAge} onInput=${e => setMinRankAge(e.target.value)} />
          </div>
          <div class="condition-field">
            <label>ที่มา</label>
            <select value=${origin} onChange=${e => setOrigin(e.target.value)}>
              <option value="">ทั้งหมด</option>
              ${origins.map(o => html`<option key=${o} value=${o}>${o}</option>`)}
            </select>
          </div>
          <div class="condition-field">
            <label>การศึกษา</label>
            <select value=${education} onChange=${e => setEducation(e.target.value)}>
              <option value="">ทั้งหมด</option>
              ${educations.map(e => html`<option key=${e} value=${e}>${e}</option>`)}
            </select>
          </div>
          <div class="condition-field">
            <label>สายงาน</label>
            <input placeholder="เช่น สธ." value=${branch} onInput=${e => setBranch(e.target.value)} />
          </div>
          <div class="condition-field">
            <label>ลชท.หลัก</label>
            <input placeholder="เช่น 916" value=${lcht} onInput=${e => setLcht(e.target.value)} />
          </div>
        </div>
        <div style=${{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style=${{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked=${onlyFilled} onChange=${e => setOnlyFilled(e.target.checked)} />
            เฉพาะผู้มีตัวตน (บรรจุจริง/ประจำ/รรก.)
          </label>
          <button class="btn btn-secondary btn-sm" onClick=${() => {
            setRank(''); setMinService(''); setMaxService(''); setMinRankAge('');
            setOrigin(''); setEducation(''); setBranch(''); setLcht('');
          }}>ล้างเงื่อนไข</button>
        </div>
      </div>

      <div class="match-results">
        <div class="match-count">
          ผลการค้นหา: <strong>${results.length}</strong> คน
        </div>
        <div class="table-container">
          <div style=${{ overflowX: 'auto' }}>
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ชื่อ-สกุล</th>
                  <th>ตำแหน่ง</th>
                  <th>ชั้นยศ</th>
                  <th>สถานะ</th>
                  <th>ที่มา</th>
                  <th>อายุราชการ</th>
                  <th>อายุยศ</th>
                  <th>ลชท.</th>
                  <th>การศึกษา</th>
                </tr>
              </thead>
              <tbody>
                ${results.slice(0, 50).map(d => {
                  const st = getStatus(d.status);
                  return html`
                    <tr key=${d.id} onClick=${() => onSelect(d)} style=${{ cursor: 'pointer' }}>
                      <td>${d.id}</td>
                      <td style=${{ fontWeight: 500 }}>${d.name || '-'}</td>
                      <td>${truncate(d.position, 20)}</td>
                      <td>${d.rank_req || '-'}</td>
                      <td><span class="status-badge ${st.cls}"><span class="status-dot"></span>${st.label}</span></td>
                      <td>${d.origin || '-'}</td>
                      <td>${d.years_service ?? '-'}</td>
                      <td>${d.years_in_rank ?? '-'}</td>
                      <td>${d.lcht_main ?? '-'}</td>
                      <td>${truncate(d.education, 12)}</td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
          ${results.length > 50 ? html`<div class="empty-state">แสดง 50 รายการแรก จากทั้งหมด ${results.length} รายการ</div>` : null}
          ${results.length === 0 ? html`<div class="empty-state">ไม่พบข้อมูลตามเงื่อนไข</div>` : null}
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  SETTINGS VIEW
// ══════════════════════════════════════════════════════

function SettingsView({ config, setConfig, onConnect, addToast }) {
  const [url, setUrl] = useState(config.apiUrl || '');
  const [sheetUrl, setSheetUrl] = useState(config.sheetUrl || '');

  const handleSave = () => {
    const newCfg = { ...config, apiUrl: url.trim(), sheetUrl: sheetUrl.trim() };
    setConfig(newCfg);
    saveConfig(newCfg);
    addToast('บันทึกการตั้งค่าสำเร็จ', 'success');
  };

  return html`
    <div class="config-card">
      <h3>ตั้งค่าการเชื่อมต่อ</h3>
      <p style=${{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20 }}>
        เชื่อมต่อกับ Google Apps Script เพื่ออ่าน/เขียนข้อมูลจาก Google Sheets
      </p>

      <div class="config-field">
        <label>Apps Script Web App URL (อ่าน+เขียน)</label>
        <input placeholder="https://script.google.com/macros/s/xxx/exec"
          value=${url} onInput=${e => setUrl(e.target.value)} />
      </div>

      <div class="config-field">
        <label>Google Sheets URL (อ่านอย่างเดียว - CSV)</label>
        <input placeholder="https://docs.google.com/spreadsheets/d/xxx/edit"
          value=${sheetUrl} onInput=${e => setSheetUrl(e.target.value)} />
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" onClick=${handleSave}>บันทึก</button>
        <button class="btn btn-secondary" onClick=${() => onConnect()}>ทดสอบเชื่อมต่อ</button>
      </div>

      <div style=${{ marginTop: 32, padding: 20, background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
        <h4 style=${{ fontSize: 14, marginBottom: 12 }}>วิธีตั้งค่า Google Apps Script</h4>
        <ol style=${{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 2, paddingLeft: 20 }}>
          <li>เปิด Google Sheets ที่มีข้อมูล</li>
          <li>ไปที่ Extensions > Apps Script</li>
          <li>คัดลอกโค้ดจากไฟล์ <code>gas/Code.gs</code></li>
          <li>Deploy > New deployment > Web app</li>
          <li>ตั้งค่า Execute as: Me, Access: Anyone</li>
          <li>คัดลอก URL มาวางในช่องด้านบน</li>
        </ol>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState(loadConfig());
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Table filters (shared state)
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLevel, setFilterLevel] = useState('');

  const addToast = useCallback((msg, type = 'info') => {
    setToasts(t => [...t, { msg, type }]);
    setTimeout(() => setToasts(t => t.slice(1)), 3000);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      const apiUrl = config.apiUrl || getApiUrl();
      if (apiUrl) {
        result = await fetchData(apiUrl);
        setConnected(true);
      } else if (config.sheetUrl) {
        result = await fetchViaCsv(config.sheetUrl);
        setConnected(true);
      } else {
        // Load demo data from bundled JSON
        const resp = await fetch('data.json');
        if (resp.ok) {
          result = await resp.json();
        } else {
          result = [];
        }
        setConnected(false);
      }
      // Ensure numeric fields
      const cleaned = (result || []).map(d => ({
        ...d,
        id: Number(d.id) || 0,
        level: Number(d.level) || 0,
        status: Number(d.status) ?? 0,
        lcht_main: d.lcht_main != null ? Number(d.lcht_main) : null,
        lcht_gen: d.lcht_gen != null ? Number(d.lcht_gen) : null,
        entry_be: d.entry_be != null ? Number(d.entry_be) : null,
        birth_be: d.birth_be != null ? Number(d.birth_be) : null,
        years_service: d.years_service != null ? Number(d.years_service) : null,
        years_in_rank: d.years_in_rank != null ? Number(d.years_in_rank) : null,
      }));
      setData(cleaned);
      if (cleaned.length > 0) addToast(`โหลดข้อมูลสำเร็จ ${cleaned.length} รายการ`, 'success');
    } catch (err) {
      addToast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error');
      setConnected(false);
    }
    setLoading(false);
  }, [config, addToast]);

  useEffect(() => { loadData(); }, []);

  const handleConnect = useCallback(() => {
    loadData();
  }, [loadData]);

  return html`
    <${Toasts} toasts=${toasts} />
    ${selectedPerson ? html`<${DetailModal} person=${selectedPerson} onClose=${() => setSelectedPerson(null)} />` : null}

    <div class="app-container">
      <header class="app-header">
        <div class="app-logo">
          <div class="app-logo-icon">T</div>
          <div>
            <h1>Team Formation</h1>
            <div class="subtitle">ระบบจัดการกำลังพล</div>
          </div>
        </div>

        <nav class="nav-tabs">
          <button class="nav-tab ${tab === 'dashboard' ? 'active' : ''}" onClick=${() => setTab('dashboard')}>ภาพรวม</button>
          <button class="nav-tab ${tab === 'table' ? 'active' : ''}" onClick=${() => setTab('table')}>ข้อมูล</button>
          <button class="nav-tab ${tab === 'formation' ? 'active' : ''}" onClick=${() => setTab('formation')}>จัดทีม</button>
          <button class="nav-tab ${tab === 'condition' ? 'active' : ''}" onClick=${() => setTab('condition')}>เงื่อนไข</button>
          <button class="nav-tab ${tab === 'settings' ? 'active' : ''}" onClick=${() => setTab('settings')}>ตั้งค่า</button>
        </nav>

        <div class="connection-bar">
          <div class="conn-dot ${connected ? 'connected' : ''}"></div>
          <span style=${{ fontSize: 12, color: 'var(--text-dim)' }}>${connected ? 'เชื่อมต่อแล้ว' : 'ออฟไลน์'}</span>
          <button class="conn-btn" onClick=${handleConnect}>${loading ? 'กำลังโหลด...' : 'โหลดข้อมูล'}</button>
        </div>
      </header>

      <main class="main-content">
        ${loading ? html`
          <div class="loading-state">
            <div class="spinner"></div>
            <div>กำลังโหลดข้อมูล...</div>
          </div>
        ` : data.length === 0 && tab !== 'settings' ? html`
          <div class="loading-state">
            <div style=${{ fontSize: 48, marginBottom: 16 }}>⚽</div>
            <div style=${{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>ยังไม่มีข้อมูล</div>
            <div style=${{ color: 'var(--text-dim)', marginBottom: 20 }}>กรุณาตั้งค่าการเชื่อมต่อ หรือวางไฟล์ data.json</div>
            <button class="btn btn-primary" onClick=${() => setTab('settings')}>ไปตั้งค่า</button>
          </div>
        ` : html`
          ${tab === 'dashboard' ? html`
            <${StatsBar} data=${data} />
            <${OrgTreeView} data=${data} onSelect=${setSelectedPerson} />
            <${DataTable} data=${data} onSelect=${setSelectedPerson}
              searchText=${searchText} setSearchText=${setSearchText}
              filterStatus=${filterStatus} setFilterStatus=${setFilterStatus}
              filterLevel=${filterLevel} setFilterLevel=${setFilterLevel} />
          ` : null}
          ${tab === 'table' ? html`
            <${DataTable} data=${data} onSelect=${setSelectedPerson}
              searchText=${searchText} setSearchText=${setSearchText}
              filterStatus=${filterStatus} setFilterStatus=${setFilterStatus}
              filterLevel=${filterLevel} setFilterLevel=${setFilterLevel} />
          ` : null}
          ${tab === 'formation' ? html`
            <${FormationView} data=${data} onDataChange=${setData}
              onSelect=${setSelectedPerson} addToast=${addToast} />
          ` : null}
          ${tab === 'condition' ? html`
            <${ConditionView} data=${data} onSelect=${setSelectedPerson} />
          ` : null}
        `}
        ${tab === 'settings' ? html`
          <${SettingsView} config=${config} setConfig=${setConfig}
            onConnect=${handleConnect} addToast=${addToast} />
        ` : null}
      </main>
    </div>
  `;
}

// ── Mount ──
createRoot(document.getElementById('root')).render(html`<${App} />`);
