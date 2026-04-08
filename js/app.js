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
//  TRANSFER RULES (จากอัตราหมายเลข 1310)
// ══════════════════════════════════════════════════════

// ชั้นยศที่อนุญาตตามตำแหน่ง
const RANK_GROUPS = {
  general: ['พล.อ.', 'พล.ท.', 'พล.ต.', 'พล.ร.อ.', 'พล.ร.ท.', 'พล.ร.ต.', 'พล.อ.อ.', 'พล.อ.ท.', 'พล.อ.ต.'],
  seniorOfficer: ['พ.อ.(พ)', 'พ.อ.', 'น.อ.'],
  officer: ['พ.ท.', 'พ.ต.', 'น.ท.', 'น.ต.', 'ร.อ.', 'ร.ท.', 'ร.ต.'],
  nco: ['จ.ส.อ.(พ)', 'จ.ส.อ.', 'จ.ส.ท.', 'จ.ส.ต.', 'ส.อ.', 'ส.ท.', 'ส.ต.'],
};

// เงื่อนไขตำแหน่งจากอัตราหมายเลข 1310 ตอนที่ 5
const TRANSFER_RULES = [
  {
    id: 'R01',
    name: 'เจ้ากรม/ผอ.สำนัก',
    desc: 'ต้องเป็นนายทหารสัญญาบัตร สายงาน สธ. ชั้น พล.ต. ขึ้นไป',
    match: (p) => p.level === 3 || p.level === 4,
    conditions: [
      { label: 'ชั้นยศ', check: (person) => RANK_GROUPS.general.includes(person.rank_req), req: 'นายพล' },
      { label: 'สายงาน', check: (person) => person.branch === 'สธ.', req: 'สธ.' },
      { label: 'ที่มา', check: (person) => ['นร.', 'นนร.', 'นนอ.', 'นนต.'].includes(person.origin), req: 'นร./นนร./นนอ./นนต.' },
    ],
  },
  {
    id: 'R02',
    name: 'ฝ่ายเสนาธิการ (สัญญาบัตร ชั้นสูง)',
    desc: 'ต้องสำเร็จ รร.เสนาธิการ หรือ วิทยาลัยการทัพ',
    match: (p) => p.level === 5 || p.level === 6,
    conditions: [
      { label: 'ชั้นยศ', check: (person) => [...RANK_GROUPS.seniorOfficer].includes(person.rank_req), req: 'พ.อ.(พ)/พ.อ./น.อ.' },
      { label: 'การศึกษา', check: (person) => person.education && ['ปริญญาตรี', 'ปริญญาโท', 'ปริญญาเอก'].includes(person.education), req: 'ปริญญาตรีขึ้นไป' },
    ],
  },
  {
    id: 'R03',
    name: 'นปก.ประจำ ยก.ทหาร',
    desc: 'บรรจุทดแทนตำแหน่ง 99 ในด้านต่างๆ (วิจัย, ฝึกอบรม, ยุทธศาสตร์)',
    match: (p) => (p.position || '').includes('นปก.ประจำ'),
    conditions: [
      { label: 'ชั้นยศ', check: (person) => person.rank_req === 'พ.อ.(พ)' || person.rank_req === 'น.อ.', req: 'พ.อ.(พ)/น.อ.' },
      { label: 'ลชท.หลัก', check: (person) => person.lcht_main === 916 || person.lcht_main === 1116, req: '916 หรือ 1116' },
    ],
  },
  {
    id: 'R04',
    name: 'ปฏิบัติการ (สัญญาบัตร)',
    desc: 'นายทหารสัญญาบัตร ชั้น พ.ท.-ร.ต.',
    match: (p) => [7, 8, 9, 10].includes(p.level),
    conditions: [
      { label: 'ชั้นยศ', check: (person) => RANK_GROUPS.officer.includes(person.rank_req), req: 'พ.ท.-ร.ต.' },
    ],
  },
  {
    id: 'R05',
    name: 'ปฏิบัติการ (ประทวน)',
    desc: 'นายทหารประทวน จ.ส.อ. ขึ้นไป',
    match: (p) => [19, 21, 22, 25, 29].includes(p.level),
    conditions: [
      { label: 'ชั้นยศ', check: (person) => RANK_GROUPS.nco.includes(person.rank_req), req: 'จ.ส.อ. ขึ้นไป' },
    ],
  },
];

// หมวดหมู่ นปก.ประจำ ด้านต่างๆ (ตอนที่ 5 ข้อ ๕.๔)
const NPK_CATEGORIES = [
  'ด้านการวิจัย', 'ด้านการวิเคราะห์', 'ด้านการฝึกอบรม', 'ด้านการเรียบเรียงตำรา',
  'ด้านวิจัยยุทธศาสตร์', 'ด้านวิชาการ', 'ด้านวิชาการศึกษา', 'ด้านวิชาการทั่วไป',
  'ด้านโครงการ', 'ด้านการบริหารจัดการ', 'ด้านเลขานุการ', 'ด้านธุรการ',
  'ด้านบริการกำลังพล', 'ด้านวิชาการพิเศษ', 'ด้านกิจการพิเศษ',
];

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

// ══════════════════════════════════════════════════════
//  SPACE FORMATION VIEW
// ══════════════════════════════════════════════════════

const PLANET_COLORS = [
  { bg: 'linear-gradient(135deg, #6366f1, #4f46e5)', glow: 'rgba(99,102,241,0.4)' },
  { bg: 'linear-gradient(135deg, #06b6d4, #0891b2)', glow: 'rgba(6,182,212,0.4)' },
  { bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', glow: 'rgba(139,92,246,0.4)' },
  { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', glow: 'rgba(245,158,11,0.4)' },
  { bg: 'linear-gradient(135deg, #22c55e, #16a34a)', glow: 'rgba(34,197,94,0.4)' },
  { bg: 'linear-gradient(135deg, #ec4899, #db2777)', glow: 'rgba(236,72,153,0.4)' },
  { bg: 'linear-gradient(135deg, #ef4444, #dc2626)', glow: 'rgba(239,68,68,0.4)' },
  { bg: 'linear-gradient(135deg, #14b8a6, #0d9488)', glow: 'rgba(20,184,166,0.4)' },
  { bg: 'linear-gradient(135deg, #f97316, #ea580c)', glow: 'rgba(249,115,22,0.4)' },
  { bg: 'linear-gradient(135deg, #3b82f6, #2563eb)', glow: 'rgba(59,130,246,0.4)' },
];

function checkConditions(person, slot, allData) {
  const checks = [];
  let blocked = false; // ถูกบล็อกไม่ให้ย้าย

  // ═══ 0. ตรวจทิศทางการย้าย (สูง->ต่ำ ห้าม / ต่ำ->สูง ต้องมีเงื่อนไข) ═══
  const slotRank = RANK_ORDER[slot.rank_req] || 99;
  const personRankClean = (person.rank_req || '').replace(/^.*?\s/, '');
  const personRank = RANK_ORDER[personRankClean] || 99;
  // RANK_ORDER: เลขน้อย = ยศสูง, เลขมาก = ยศต่ำ
  // personRank < slotRank = คนมียศสูงกว่าตำแหน่ง (ย้ายลง) -> ห้าม
  // personRank > slotRank = คนมียศต่ำกว่าตำแหน่ง (ย้ายขึ้น) -> ต้องผ่านเงื่อนไข
  // personRank === slotRank = ยศเท่ากัน -> ย้ายได้ตามปกติ

  const direction = personRank === slotRank ? 'same'
    : personRank < slotRank ? 'down'  // ยศสูงกว่าตำแหน่ง = ย้ายลง
    : 'up'; // ยศต่ำกว่าตำแหน่ง = ย้ายขึ้น

  if (direction === 'down' && slot.rank_req && person.rank_req) {
    // ═══ ห้ามย้ายลง: ยศสูงกว่า ห้ามย้ายไปตำแหน่งต่ำกว่า ═══
    blocked = true;
    checks.push({
      label: 'ทิศทางย้าย',
      req: 'ห้ามย้ายลง (ยศสูงกว่าตำแหน่ง)',
      val: `${person.rank_req} -> ${slot.rank_req}`,
      pass: false,
      critical: true,
    });
  }

  if (direction === 'up' && slot.rank_req && person.rank_req) {
    // ═══ ย้ายขึ้น: ยศต่ำกว่าต้องผ่านเงื่อนไขเพิ่มเติม ═══
    checks.push({
      label: 'ทิศทางย้าย',
      req: 'ย้ายขึ้น (ต้องผ่านเงื่อนไข)',
      val: `${person.rank_req} -> ${slot.rank_req}`,
      pass: true, // อนุญาตแต่ต้องผ่านเงื่อนไขอื่นทั้งหมด
      info: true,
    });
  }

  // ถ้าถูกบล็อก (ย้ายลง) คืนผลทันที ไม่ต้องตรวจเงื่อนไขอื่น
  if (blocked) {
    return { checks, allPass: false, passCount: 0, totalChecks: checks.length, rule: null, blocked: true, direction };
  }

  // ═══ 1. ตรวจชั้นยศ (อ้างอิงอัตราหมายเลข 1310) ═══
  if (slot.rank_req && person.rank_req) {
    if (direction === 'up') {
      // ย้ายขึ้น: ยอมรับยศต่ำกว่าได้ไม่เกิน 1 ขั้น
      const pass = (personRank - slotRank) <= 1;
      checks.push({ label: 'ชั้นยศ', req: `${slot.rank_req} (ต่ำกว่าได้ไม่เกิน 1 ขั้น)`, val: person.rank_req || '-', pass });
    } else {
      // ยศเท่ากัน: ตรงตำแหน่งพอดี
      checks.push({ label: 'ชั้นยศ', req: slot.rank_req, val: person.rank_req || '-', pass: true });
    }
  }

  // ═══ 2. ตรวจสายงาน ═══
  if (slot.branch && slot.branch !== '*') {
    const pass = !person.branch || person.branch === slot.branch;
    checks.push({ label: 'สายงาน', req: slot.branch, val: person.branch || '-', pass: pass || !person.branch });
  }

  // ═══ 3. ตรวจ ลชท.หลัก ═══
  if (slot.position_detail) {
    const lchtMatch = slot.position_detail.match(/ลชท\.หลัก\s*(?:สธ\.)?(\d+)/);
    if (lchtMatch && person.lcht_main) {
      const pass = String(person.lcht_main) === lchtMatch[1];
      checks.push({ label: 'ลชท.หลัก', req: lchtMatch[1], val: String(person.lcht_main), pass });
    }
  }

  // ═══ 4. ตรวจเงื่อนไขตามอัตราหมายเลข 1310 ═══
  const rule = TRANSFER_RULES.find(r => r.match(slot));
  if (rule) {
    for (const cond of rule.conditions) {
      if (cond.label === 'ชั้นยศ' && checks.some(c => c.label === 'ชั้นยศ')) continue;
      if (cond.label === 'สายงาน' && checks.some(c => c.label === 'สายงาน')) continue;
      const pass = cond.check(person);
      checks.push({
        label: cond.label + ' (อัตรา 1310)',
        req: cond.req,
        val: person[cond.label === 'ชั้นยศ' ? 'rank_req' : cond.label === 'สายงาน' ? 'branch' : cond.label === 'ที่มา' ? 'origin' : cond.label === 'การศึกษา' ? 'education' : cond.label === 'ลชท.หลัก' ? 'lcht_main' : '-'] || '-',
        pass,
        ruleId: rule.id,
        ruleName: rule.name,
      });
    }
  }

  // ═══ 5. ตรวจอายุราชการ (ระดับ 3-4 ต้อง >= 25 ปี) ═══
  if (slot.level <= 4 && person.years_service != null) {
    const pass = person.years_service >= 25;
    checks.push({ label: 'อายุราชการ', req: '>= 25 ปี', val: person.years_service + ' ปี', pass });
  }

  // ═══ 6. ตรวจอายุยศ ═══
  if (direction === 'up') {
    // ย้ายขึ้น: ต้องมีอายุยศ >= 3 ปี
    if (person.years_in_rank != null) {
      const pass = person.years_in_rank >= 3;
      checks.push({ label: 'อายุยศ (ย้ายขึ้น)', req: '>= 3 ปี', val: person.years_in_rank + ' ปี', pass });
    }
  } else if (slot.level <= 4 && person.years_in_rank != null) {
    const pass = person.years_in_rank >= 2;
    checks.push({ label: 'อายุยศ', req: '>= 2 ปี', val: person.years_in_rank + ' ปี', pass });
  }

  // ═══ 7. ตรวจเหล่า (corps) — ลชท.หลัก/ลชท.รอง ต้องตรงกับเหล่าที่ตำแหน่งต้องการ ═══
  if (allData) {
    const sectionCorps = inferPositionCorps(slot, allData);
    if (sectionCorps && sectionCorps.length > 0) {
      // ใช้เหล่าที่พบมากสุดในหน่วย เป็นเหล่าหลักของตำแหน่ง
      const topCorps = sectionCorps[0][0];
      const totalInSection = sectionCorps.reduce((s, [, c]) => s + c, 0);
      const topCount = sectionCorps[0][1];
      const dominance = topCount / totalInSection;

      // ถ้าเหล่าหลักมีสัดส่วน >= 40% ของหน่วย ถือว่ากำหนดเหล่า
      if (dominance >= 0.4 && topCount >= 2) {
        const result = checkCorpsMatch(person, topCorps);
        // รวมเหล่าที่ยอมรับ (top 2 ถ้ามีสัดส่วนใกล้กัน)
        let accepted = topCorps;
        if (sectionCorps.length > 1) {
          const secondCorps = sectionCorps[1][0];
          const secondCount = sectionCorps[1][1];
          if (secondCount / totalInSection >= 0.2) {
            const result2 = checkCorpsMatch(person, secondCorps);
            if (result2.pass) {
              checks.push({
                label: 'เหล่า',
                req: `${topCorps} หรือ ${secondCorps}`,
                val: `${person.corps || '-'} (${result2.reason})`,
                pass: true,
              });
            } else if (result.pass) {
              checks.push({
                label: 'เหล่า',
                req: `${topCorps} หรือ ${secondCorps}`,
                val: `${person.corps || '-'} (${result.reason})`,
                pass: true,
              });
            } else {
              checks.push({
                label: 'เหล่า',
                req: `${topCorps} หรือ ${secondCorps}`,
                val: `${person.corps || '-'}`,
                pass: false,
              });
            }
          } else {
            checks.push({
              label: 'เหล่า',
              req: topCorps,
              val: `${person.corps || '-'}${result.pass ? ' (' + result.reason + ')' : ''}`,
              pass: result.pass,
            });
          }
        } else {
          checks.push({
            label: 'เหล่า',
            req: topCorps,
            val: `${person.corps || '-'}${result.pass ? ' (' + result.reason + ')' : ''}`,
            pass: result.pass,
          });
        }
      }
    }
  }

  const allPass = checks.length === 0 || checks.every(c => c.pass);
  const passCount = checks.filter(c => c.pass).length;
  const totalChecks = checks.length;
  return { checks, allPass, passCount, totalChecks, rule, blocked: false, direction };
}

// หาผู้มีคุณสมบัติเหมาะสมกับตำแหน่งว่าง
// ══════════════════════════════════════════════════════
//  CORPS / เหล่า MATCHING SYSTEM
// ══════════════════════════════════════════════════════

// สร้าง mapping เหล่า -> ลชท. จากข้อมูลจริง (position_detail ของคนที่บรรจุ)
let _corpsLchtCache = null;
let _sectionCorpsCache = null;

function buildCorpsMap(allData) {
  if (_corpsLchtCache) return;
  const corpsLcht = {};   // corps -> Set of lcht codes
  const sectionCorps = {}; // section(8-digit) -> { corps: count }

  for (const d of allData) {
    if (!d.name) continue;
    const corps = d.corps || '';
    const pc = String(d.pos_code || '').substring(0, 8);

    // สร้าง section -> corps mapping
    if (corps && pc) {
      if (!sectionCorps[pc]) sectionCorps[pc] = {};
      sectionCorps[pc][corps] = (sectionCorps[pc][corps] || 0) + 1;
    }

    // สร้าง corps -> lcht mapping จาก position_detail
    const pd = d.position_detail || '';
    if (!corps || !pd) continue;

    // parse ลชท.หลัก
    const mainMatch = pd.match(/ลชท\.หลัก\s*(?:สธ\.)?\s*(\d+)/);
    if (mainMatch) {
      if (!corpsLcht[corps]) corpsLcht[corps] = new Set();
      corpsLcht[corps].add(mainMatch[1]);
    }

    // parse ลชท.รอง
    const subMatch = pd.match(/ลชท\.รอง\s+([\d,]+)/);
    if (subMatch) {
      for (const code of subMatch[1].split(',')) {
        const c = code.trim();
        if (c && c !== '-') {
          if (!corpsLcht[corps]) corpsLcht[corps] = new Set();
          corpsLcht[corps].add(c);
        }
      }
    }
  }

  // Convert Sets to Arrays
  _corpsLchtCache = {};
  for (const [corps, codes] of Object.entries(corpsLcht)) {
    _corpsLchtCache[corps] = [...codes];
  }
  _sectionCorpsCache = sectionCorps;
}

// หาเหล่าที่ตำแหน่งต้องการ จาก section ที่ตำแหน่งอยู่
function inferPositionCorps(slot, allData) {
  buildCorpsMap(allData);
  const pc = String(slot.pos_code || '').substring(0, 8);
  const sCorps = _sectionCorpsCache[pc];
  if (!sCorps) return null;
  // เรียงตาม count มากสุด
  const sorted = Object.entries(sCorps).sort((a, b) => b[1] - a[1]);
  return sorted; // [[corps, count], ...]
}

// ตรวจว่าคนมี ลชท. ตรงกับเหล่าที่ต้องการไหม
function checkCorpsMatch(person, requiredCorps) {
  // 1. ตรวจเหล่าโดยตรง
  if (person.corps === requiredCorps) return { pass: true, reason: `เหล่า ${person.corps} ตรง` };

  // 2. ตรวจ ลชท.หลัก ว่าอยู่ในเหล่าที่ต้องการไหม
  if (_corpsLchtCache && person.lcht_main) {
    const requiredLchts = _corpsLchtCache[requiredCorps] || [];
    const personLcht = String(Math.floor(person.lcht_main));
    // ตรวจ ลชท.หลัก ตรงกับเหล่า
    if (requiredLchts.includes(personLcht) || requiredLchts.includes('0' + personLcht)) {
      return { pass: true, reason: `ลชท.หลัก ${personLcht} อยู่ในเหล่า ${requiredCorps}` };
    }
  }

  // 3. ตรวจ ลชท.รอง จาก position_detail ของคน
  if (person.position_detail && _corpsLchtCache) {
    const subMatch = person.position_detail.match(/ลชท\.รอง\s+([\d,]+)/);
    if (subMatch) {
      const requiredLchts = _corpsLchtCache[requiredCorps] || [];
      for (const code of subMatch[1].split(',')) {
        const c = code.trim();
        if (c && requiredLchts.includes(c)) {
          return { pass: true, reason: `ลชท.รอง ${c} อยู่ในเหล่า ${requiredCorps}` };
        }
      }
    }
  }

  return { pass: false, reason: `ไม่มี ลชท. ตรงกับเหล่า ${requiredCorps}` };
}

// คำนวณอายุตัว (ปี พ.ศ. ปัจจุบัน - ปีเกิด)
const CURRENT_BE = new Date().getFullYear() + 543;
function calcAge(birthBe) { return birthBe ? CURRENT_BE - birthBe : 0; }

// คำนวณคะแนนอาวุโส (เรียงจากมากไปน้อย = อาวุโสมากสุดก่อน)
function seniorityScore(person) {
  const rankOrder = RANK_ORDER[person.rank_req] || 99;
  const yearsService = person.years_service ?? 0;
  const yearsInRank = person.years_in_rank ?? 0;
  const age = calcAge(person.birth_be);
  // ยิ่งยศสูง (เลขน้อย) = อาวุโสมาก, ยิ่งอายุราชการ/อายุยศ/อายุตัว มาก = อาวุโสมาก
  return { rankOrder, yearsService, yearsInRank, age };
}

function findEligibleCandidates(slot, allData) {
  // ค้นหาเฉพาะคนที่มีตัวตน (บรรจุจริง/ประจำ/รรก.)
  const people = allData.filter(d =>
    (d.status === 1 || d.status === 7 || d.status === 5) && d.name && d.id !== slot.id
  );
  return people.map(person => {
    const result = checkConditions(person, slot, allData);
    const seniority = seniorityScore(person);
    return { ...person, condResult: result, seniority };
  }).sort((a, b) => {
    // blocked (ย้ายลง) อยู่ท้ายสุดเสมอ
    if (a.condResult.blocked !== b.condResult.blocked) return a.condResult.blocked ? 1 : -1;
    // ผ่านทั้งหมด > ไม่ผ่าน
    if (b.condResult.allPass !== a.condResult.allPass) return b.condResult.allPass ? 1 : -1;
    // ทิศทาง: ยศเท่ากัน > ย้ายขึ้น
    if (a.condResult.direction !== b.condResult.direction) {
      const order = { same: 0, up: 1, down: 2 };
      return (order[a.condResult.direction] || 2) - (order[b.condResult.direction] || 2);
    }
    // ═══ จัดลำดับอาวุโส ═══
    // 1. ชั้นยศ (เลขน้อย = ยศสูงกว่า = อาวุโสกว่า)
    if (a.seniority.rankOrder !== b.seniority.rankOrder) return a.seniority.rankOrder - b.seniority.rankOrder;
    // 2. อายุครองยศ (มากกว่า = อาวุโสกว่า)
    if (b.seniority.yearsInRank !== a.seniority.yearsInRank) return b.seniority.yearsInRank - a.seniority.yearsInRank;
    // 3. อายุราชการ (มากกว่า = อาวุโสกว่า)
    if (b.seniority.yearsService !== a.seniority.yearsService) return b.seniority.yearsService - a.seniority.yearsService;
    // 4. อายุตัว (มากกว่า = อาวุโสกว่า)
    return b.seniority.age - a.seniority.age;
  });
}

function SpaceFormationView({ data, onDataChange, onSelect, addToast }) {
  const canvasRef = useRef(null);
  const [dragPerson, setDragPerson] = useState(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [hoverSlot, setHoverSlot] = useState(null);
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [condPopup, setCondPopup] = useState(null);
  const [searchCrew, setSearchCrew] = useState('');
  const [crewFilter, setCrewFilter] = useState('all');
  const [zoom, setZoom] = useState(1);

  // Build planets from departments
  const planets = useMemo(() => {
    const tree = buildOrgTree(data);
    const cx = 600, cy = 400;
    return tree.map((dept, i) => {
      const angle = (i / tree.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 260 + (i % 2) * 60;
      const size = 40 + Math.min(dept.all.length / 3, 40);
      return {
        ...dept,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        size,
        color: PLANET_COLORS[i % PLANET_COLORS.length],
        vacantSlots: dept.vacant.slice(0, 8),
        filledPeople: dept.filled.slice(0, 12),
      };
    });
  }, [data]);

  // Crew members (all filled + reserve)
  const crew = useMemo(() => {
    let list = data.filter(d => d.status === 1 || d.status === 7 || d.status === 5);
    if (searchCrew) {
      const q = searchCrew.toLowerCase();
      list = list.filter(d => (d.name || '').toLowerCase().includes(q) || (d.rank_req || '').toLowerCase().includes(q));
    }
    if (crewFilter === 'reserve') list = list.filter(d => d.status === 7 || d.status === 5);
    if (crewFilter === 'officer') list = list.filter(d => d.level <= 10);
    if (crewFilter === 'nco') list = list.filter(d => d.level > 10);
    return list;
  }, [data, searchCrew, crewFilter]);

  // Generate stars
  const stars = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 120; i++) {
      arr.push({
        x: Math.random() * 1400,
        y: Math.random() * 900,
        s: Math.random() * 2 + 0.5,
        dur: Math.random() * 4 + 2,
        o1: Math.random() * 0.3 + 0.1,
        o2: Math.random() * 0.5 + 0.4,
      });
    }
    return arr;
  }, []);

  // Drag handlers
  const handleMouseMove = useCallback((e) => {
    if (dragPerson) setDragPos({ x: e.clientX, y: e.clientY });
  }, [dragPerson]);

  const handleMouseUp = useCallback((e) => {
    if (!dragPerson || !hoverSlot) {
      setDragPerson(null);
      setCondPopup(null);
      return;
    }
    // Check conditions
    const { checks, allPass } = checkConditions(dragPerson, hoverSlot, data);

    if (checks.length > 0) {
      setCondPopup({ person: dragPerson, slot: hoverSlot, checks, allPass, x: e.clientX, y: e.clientY });
      return;
    }
    // No conditions to check, just place
    confirmPlace(dragPerson, hoverSlot);
  }, [dragPerson, hoverSlot, data]);

  const confirmPlace = (person, slot) => {
    const newData = data.map(d => {
      if (d.id === slot.id) {
        return { ...d, status: 1, name: person.name, person_id: person.person_id,
          origin: person.origin, corps: person.corps, education: person.education,
          lcht_main: person.lcht_main, lcht_gen: person.lcht_gen,
          entry_be: person.entry_be, years_service: person.years_service,
          birth_be: person.birth_be, years_in_rank: person.years_in_rank,
          position_detail: person.position_detail || slot.position_detail,
          rank_req: slot.rank_req, status_text: 'บรรจุจริง' };
      }
      if (d.id === person.id) {
        return { ...d, status: 0, name: '', person_id: null,
          origin: '', corps: '', education: '',
          lcht_main: null, lcht_gen: null,
          entry_be: null, years_service: null,
          birth_be: null, years_in_rank: null,
          position_detail: '', status_text: 'ว่าง' };
      }
      return d;
    });
    onDataChange(newData);
    addToast(`ส่ง ${person.name} ไปตำแหน่ง ${slot.position} สำเร็จ`, 'success');
    setDragPerson(null);
    setHoverSlot(null);
    setCondPopup(null);
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Orbit positions around planet
  const getOrbitPos = (planet, index, total, orbitR) => {
    const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
    return {
      left: planet.x + Math.cos(angle) * orbitR - 18,
      top: planet.y + Math.sin(angle) * orbitR - 18,
    };
  };

  const photo = (p) => p?.person_id ? getPhoto(String(p.person_id)) : null;

  return html`
    <div class="space-layout" style=${{ position: 'relative' }}>
      <!-- Space Canvas -->
      <div class="space-canvas" ref=${canvasRef}>
        <div style=${{ width: 1400, height: 900, position: 'relative', transform: 'scale(' + zoom + ')', transformOrigin: 'center center' }}>
          <!-- Stars -->
          <div class="space-stars">
            ${stars.map((s, i) => html`
              <div key=${i} class="space-star" style=${{
                left: s.x + 'px', top: s.y + 'px',
                width: s.s + 'px', height: s.s + 'px',
                '--dur': s.dur + 's', '--o1': s.o1, '--o2': s.o2
              }}></div>
            `)}
          </div>

          <!-- Center label -->
          <div style=${{ position: 'absolute', top: 360, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none', zIndex: 2 }}>
            <div style=${{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.15)', letterSpacing: 2 }}>กรมยุทธการทหาร</div>
            <div style=${{ fontSize: 11, color: 'rgba(255,255,255,0.08)', marginTop: 4 }}>ลากคนจากด้านขวา วางลงบนวงโคจร</div>
          </div>

          <!-- Planets -->
          ${planets.map((p, pi) => {
            const orbitR = p.size + 30;
            const orbitR2 = p.size + 60;
            const allOrbit = [...p.filledPeople, ...p.vacantSlots];
            return html`
              <div key=${p.code} class="space-planet-group" style=${{ left: p.x + 'px', top: p.y + 'px', transform: 'translate(-50%,-50%)' }}>
                <!-- Orbit rings -->
                <div class="orbit-ring" style=${{ width: orbitR * 2 + 'px', height: orbitR * 2 + 'px', left: -orbitR + 'px', top: -orbitR + 'px' }}></div>
                ${allOrbit.length > 8 ? html`<div class="orbit-ring" style=${{ width: orbitR2 * 2 + 'px', height: orbitR2 * 2 + 'px', left: -orbitR2 + 'px', top: -orbitR2 + 'px' }}></div>` : null}

                <!-- Planet core -->
                <div class="space-planet ${selectedPlanet === p.code ? 'selected' : ''}"
                  style=${{ width: p.size + 'px', height: p.size + 'px', background: p.color.bg, '--glow-color': p.color.glow }}
                  onClick=${() => setSelectedPlanet(selectedPlanet === p.code ? null : p.code)}>
                  <span class="planet-count">${p.filled.length}</span>
                  <span class="planet-label">${p.short}</span>
                  <span class="planet-sub">${p.filled.length}/${p.all.length}</span>
                </div>

                <!-- Filled people orbiting -->
                ${p.filledPeople.map((person, oi) => {
                  const pos = getOrbitPos({ x: 0, y: 0 }, oi, Math.min(allOrbit.length, 8), orbitR);
                  const ph = photo(person);
                  return html`
                    <div key=${person.id} class="orbit-person"
                      style=${{ left: pos.left + 'px', top: pos.top + 'px', background: ph ? 'transparent' : '#22c55e' }}
                      onClick=${() => onSelect(person)}>
                      ${ph ? html`<img src=${ph} />` : (person.name || '?').charAt(0)}
                      <div class="person-tooltip">${person.name}<br/>${person.rank_req}</div>
                    </div>
                  `;
                })}

                <!-- Vacant orbit slots -->
                ${p.vacantSlots.map((slot, oi) => {
                  const pos = getOrbitPos({ x: 0, y: 0 }, p.filledPeople.length + oi, Math.min(allOrbit.length, 8), orbitR);
                  const isHover = hoverSlot?.id === slot.id;
                  const cond = isHover && dragPerson ? checkConditions(dragPerson, slot, data) : null;
                  return html`
                    <div key=${slot.id}
                      class="orbit-slot ${isHover ? (cond?.allPass !== false ? 'drop-hover' : 'drop-invalid') : ''}"
                      style=${{ left: pos.left + 'px', top: pos.top + 'px' }}
                      onMouseEnter=${() => { if (dragPerson) setHoverSlot(slot); }}
                      onMouseLeave=${() => setHoverSlot(null)}
                      onClick=${() => onSelect(slot)}>
                      ?
                    </div>
                  `;
                })}
              </div>
            `;
          })}
        </div>

        <!-- Zoom controls -->
        <div class="space-controls">
          <button onClick=${() => setZoom(z => Math.min(z + 0.1, 1.5))}>+</button>
          <button onClick=${() => setZoom(z => Math.max(z - 0.1, 0.5))}>−</button>
          <button onClick=${() => setZoom(1)}>⟳</button>
        </div>
      </div>

      <!-- Crew Panel (Right) -->
      <div class="crew-panel">
        <div class="crew-header">
          <h3>กำลังพล (${crew.length})</h3>
          <input class="crew-search" placeholder="ค้นหาชื่อ, ยศ..."
            value=${searchCrew} onInput=${e => setSearchCrew(e.target.value)} />
        </div>
        <div class="crew-filters">
          ${[['all','ทั้งหมด'],['reserve','สำรอง/รรก.'],['officer','สัญญาบัตร'],['nco','ประทวน']].map(([k, l]) => html`
            <button key=${k} class="crew-filter-btn ${crewFilter === k ? 'active' : ''}"
              onClick=${() => setCrewFilter(k)}>${l}</button>
          `)}
        </div>
        <div class="crew-list">
          ${crew.map(p => {
            const st = getStatus(p.status);
            const ph = photo(p);
            return html`
              <div key=${p.id} class="crew-member ${dragPerson?.id === p.id ? 'dragging' : ''}"
                onMouseDown=${(e) => { e.preventDefault(); setDragPerson(p); setDragPos({ x: e.clientX, y: e.clientY }); }}
                onClick=${() => { if (!dragPerson) onSelect(p); }}>
                <div class="cm-avatar" style=${{ background: ph ? 'transparent' : st.color }}>
                  ${ph ? html`<img src=${ph} />` : (p.name || '?').charAt(0)}
                </div>
                <div class="cm-info">
                  <div class="cm-name">${p.name || '-'}</div>
                  <div class="cm-meta">${truncate(p.position, 20)} | ${p.years_service ?? '-'}ปี</div>
                </div>
                <div class="cm-rank">${p.rank_req || '-'}</div>
              </div>
            `;
          })}
          ${crew.length === 0 ? html`<div class="empty-state">ไม่พบกำลังพล</div>` : null}
        </div>
      </div>

      <!-- Drag ghost -->
      ${dragPerson ? html`
        <div class="drag-ghost" style=${{ left: dragPos.x + 'px', top: dragPos.y + 'px', background: photo(dragPerson) ? 'transparent' : 'var(--accent)' }}>
          ${photo(dragPerson) ? html`<img src=${photo(dragPerson)} />` : (dragPerson.name || '?').charAt(0)}
        </div>
      ` : null}

      <!-- Condition Popup -->
      ${condPopup ? html`
        <div class="condition-popup" style=${{ left: Math.min(condPopup.x, window.innerWidth - 300) + 'px', top: condPopup.y - 200 + 'px', position: 'fixed' }}>
          <h4>ตรวจเงื่อนไข: ${condPopup.slot.position}</h4>
          ${condPopup.checks.map((c, i) => html`
            <div key=${i} class="condition-item">
              <span class="cond-label">${c.label}</span>
              <span>ต้องการ: ${c.req}</span>
              <span class=${c.pass ? 'cond-pass' : 'cond-fail'}>${c.val} ${c.pass ? '✓' : '✗'}</span>
            </div>
          `)}
          <div class="condition-actions">
            <button class="btn btn-primary btn-sm" onClick=${() => confirmPlace(condPopup.person, condPopup.slot)}>
              ${condPopup.allPass ? 'ยืนยันบรรจุ' : 'บรรจุถึงแม้ไม่ผ่าน'}
            </button>
            <button class="btn btn-secondary btn-sm" onClick=${() => { setCondPopup(null); setDragPerson(null); }}>ยกเลิก</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}

// Legacy alias
function FormationView(props) { return html`<${SpaceFormationView} ...${props} />`; }

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
//  TRANSFER PREPARATION VIEW (เตรียมปรับย้าย)
// ══════════════════════════════════════════════════════

function TransferPrepView({ data, onSelect, addToast }) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [filterDept, setFilterDept] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState('seniority'); // seniority, age, service, rank_age
  const [simulations, setSimulations] = useState([]); // จำลองการย้าย

  // ตำแหน่งว่าง
  const vacantSlots = useMemo(() => {
    let slots = data.filter(d => d.status === 0);
    if (filterDept) slots = slots.filter(d => String(d.pos_code).startsWith(filterDept));
    if (filterLevel) slots = slots.filter(d => {
      const lvl = Number(filterLevel);
      return LEVEL_GROUPS.some(g => g.levels.includes(lvl) && g.levels.includes(d.level));
    });
    return slots;
  }, [data, filterDept, filterLevel]);

  // สรุปตำแหน่งว่างตามกอง
  const vacantByDept = useMemo(() => {
    const map = {};
    data.filter(d => d.status === 0).forEach(d => {
      const dc = String(d.pos_code).substring(0, 5);
      if (!map[dc]) map[dc] = { count: 0, slots: [] };
      map[dc].count++;
      map[dc].slots.push(d);
    });
    return map;
  }, [data]);

  // เลือกตำแหน่งว่างแล้วหาผู้เหมาะสม
  const handleSelectSlot = useCallback((slot) => {
    setSelectedSlot(slot);
    const eligible = findEligibleCandidates(slot, data);
    setCandidates(eligible);
  }, [data]);

  // จำลองการย้าย
  const addSimulation = useCallback((person, slot) => {
    const result = checkConditions(person, slot, data);
    setSimulations(prev => [...prev, {
      id: Date.now(),
      person,
      slot,
      result,
    }]);
    addToast(`จำลอง: ${person.name} -> ${slot.position}`, 'info');
  }, [addToast]);

  const removeSimulation = useCallback((simId) => {
    setSimulations(prev => prev.filter(s => s.id !== simId));
  }, []);

  // สรุปความพร้อม
  const readiness = useMemo(() => {
    const totalVacant = data.filter(d => d.status === 0).length;
    const totalFilled = data.filter(d => d.status === 1).length;
    const totalReserve = data.filter(d => d.status === 7 || d.status === 5).length;
    const deptStats = Object.entries(vacantByDept).map(([dc, v]) => {
      const info = DEPT_NAMES[dc] || { name: dc, short: dc };
      return { ...info, code: dc, vacant: v.count };
    }).sort((a, b) => b.vacant - a.vacant);
    return { totalVacant, totalFilled, totalReserve, deptStats };
  }, [data, vacantByDept]);

  return html`
    <div class="transfer-prep">
      <!-- Summary Cards -->
      <div class="tp-summary">
        <div class="tp-card tp-card-vacant">
          <div class="tp-card-icon">!</div>
          <div class="tp-card-body">
            <div class="tp-card-value">${readiness.totalVacant}</div>
            <div class="tp-card-label">ตำแหน่งว่าง</div>
            <div class="tp-card-sub">รอบรรจุ/ปรับย้าย</div>
          </div>
        </div>
        <div class="tp-card tp-card-filled">
          <div class="tp-card-icon">O</div>
          <div class="tp-card-body">
            <div class="tp-card-value">${readiness.totalFilled}</div>
            <div class="tp-card-label">บรรจุจริง</div>
            <div class="tp-card-sub">ตัวจริงในตำแหน่ง</div>
          </div>
        </div>
        <div class="tp-card tp-card-reserve">
          <div class="tp-card-icon">R</div>
          <div class="tp-card-body">
            <div class="tp-card-value">${readiness.totalReserve}</div>
            <div class="tp-card-label">ตัวสำรอง/รรก.</div>
            <div class="tp-card-sub">พร้อมปรับย้าย</div>
          </div>
        </div>
        <div class="tp-card tp-card-sim">
          <div class="tp-card-icon">S</div>
          <div class="tp-card-body">
            <div class="tp-card-value">${simulations.length}</div>
            <div class="tp-card-label">จำลองย้าย</div>
            <div class="tp-card-sub">รายการจำลอง</div>
          </div>
        </div>
      </div>

      <div class="tp-layout">
        <!-- LEFT: ตำแหน่งว่าง -->
        <div class="tp-panel tp-vacant-panel">
          <h3 class="tp-panel-title">ตำแหน่งว่าง (${vacantSlots.length})</h3>
          <div class="tp-filters">
            <select value=${filterDept} onChange=${e => setFilterDept(e.target.value)}>
              <option value="">ทุกกอง/สำนัก</option>
              ${Object.entries(DEPT_NAMES).map(([k, v]) => {
                const vc = (vacantByDept[k]?.count || 0);
                return html`<option key=${k} value=${k}>${v.short} (${vc} ว่าง)</option>`;
              })}
            </select>
          </div>

          <div class="tp-slot-list">
            ${vacantSlots.map(slot => {
              const dc = String(slot.pos_code).substring(0, 5);
              const deptInfo = DEPT_NAMES[dc] || { short: dc };
              const rule = TRANSFER_RULES.find(r => r.match(slot));
              const isSelected = selectedSlot?.id === slot.id;
              return html`
                <div key=${slot.id} class="tp-slot ${isSelected ? 'selected' : ''}" onClick=${() => handleSelectSlot(slot)}>
                  <div class="tp-slot-header">
                    <span class="tp-slot-dept">${deptInfo.short}</span>
                    <span class="tp-slot-rank">${slot.rank_req || '-'}</span>
                  </div>
                  <div class="tp-slot-name">${slot.position || '-'}</div>
                  <div class="tp-slot-meta">
                    ${slot.branch && slot.branch !== '*' ? html`<span class="tp-tag">สาย:${slot.branch}</span>` : null}
                    ${rule ? html`<span class="tp-tag tp-tag-rule">${rule.id}</span>` : null}
                    ${slot.lcht_main ? html`<span class="tp-tag">ลชท:${slot.lcht_main}</span>` : null}
                  </div>
                </div>
              `;
            })}
            ${vacantSlots.length === 0 ? html`<div class="tp-empty">ไม่พบตำแหน่งว่าง</div>` : null}
          </div>
        </div>

        <!-- RIGHT: ผู้เหมาะสม -->
        <div class="tp-panel tp-candidate-panel">
          ${selectedSlot ? html`
            <div class="tp-selected-slot">
              <h3 class="tp-panel-title">ตำแหน่ง: ${selectedSlot.position}</h3>
              <div class="tp-slot-detail">
                <span>ชั้นยศที่ต้องการ: <strong>${selectedSlot.rank_req || '-'}</strong></span>
                <span>สายงาน: <strong>${selectedSlot.branch || '-'}</strong></span>
                <span>ระดับ: <strong>${selectedSlot.level}</strong></span>
              </div>
              ${(() => {
                const rule = TRANSFER_RULES.find(r => r.match(selectedSlot));
                return rule ? html`
                  <div class="tp-rule-info">
                    <strong>${rule.id}: ${rule.name}</strong>
                    <p>${rule.desc}</p>
                  </div>
                ` : null;
              })()}
            </div>

            ${(() => {
              // กรองเฉพาะผู้ผ่านเงื่อนไข หรือทั้งหมด
              let filtered = showAll ? candidates.filter(c => !c.condResult.blocked) : candidates.filter(c => c.condResult.allPass);

              // เรียงลำดับตาม sortBy
              if (sortBy !== 'seniority') {
                filtered = [...filtered].sort((a, b) => {
                  if (sortBy === 'age') return calcAge(b.birth_be) - calcAge(a.birth_be);
                  if (sortBy === 'service') return (b.years_service ?? 0) - (a.years_service ?? 0);
                  if (sortBy === 'rank_age') return (b.years_in_rank ?? 0) - (a.years_in_rank ?? 0);
                  return 0;
                });
              }

              const qualifiedCount = candidates.filter(c => c.condResult.allPass).length;

              return html`
                <div class="tp-candidate-header">
                  <h4>ผ่านเงื่อนไข <strong>${qualifiedCount}</strong> คน</h4>
                  <label class="tp-toggle">
                    <input type="checkbox" checked=${showAll} onChange=${e => setShowAll(e.target.checked)} />
                    รวมไม่ผ่าน
                  </label>
                </div>

                <div class="tp-sort-bar">
                  <span class="tp-sort-label">เรียงตาม:</span>
                  ${[
                    ['seniority', 'อาวุโส'],
                    ['age', 'อายุตัว'],
                    ['service', 'อายุราชการ'],
                    ['rank_age', 'อายุครองยศ'],
                  ].map(([k, l]) => html`
                    <button key=${k} class="tp-sort-btn ${sortBy === k ? 'active' : ''}"
                      onClick=${() => setSortBy(k)}>${l}</button>
                  `)}
                </div>

                <div class="tp-candidate-list">
                  ${filtered.slice(0, 80).map((person, idx) => {
                    const st = getStatus(person.status);
                    const ph = person.person_id ? getPhoto(String(person.person_id)) : null;
                    const cr = person.condResult;
                    const age = calcAge(person.birth_be);
                    return html`
                      <div key=${person.id} class="tp-candidate ${cr.blocked ? 'blocked' : cr.allPass ? 'pass' : 'partial'}">
                        <div class="tp-cand-rank-num">${idx + 1}</div>
                        <div class="tp-cand-left" onClick=${() => onSelect(person)}>
                          ${cr.direction === 'up' ? html`<div class="tp-direction tp-dir-up" title="ย้ายขึ้น">^</div>` : cr.direction === 'down' ? html`<div class="tp-direction tp-dir-down" title="ห้ามย้ายลง">X</div>` : html`<div class="tp-direction tp-dir-same" title="ยศเท่ากัน">=</div>`}
                          <div class="tp-cand-avatar" style=${{ background: ph ? 'transparent' : st.color }}>
                            ${ph ? html`<img src=${ph} />` : (person.name || '?').charAt(0)}
                          </div>
                          <div class="tp-cand-info">
                            <div class="tp-cand-name">${person.name || '-'}</div>
                            <div class="tp-cand-meta">
                              ${person.rank_req || '-'} | ${person.corps ? 'เหล่า ' + person.corps : '-'} | ${person.origin || '-'}
                            </div>
                            <div class="tp-cand-seniority">
                              <span title="อายุตัว">อายุ ${age || '-'}ปี</span>
                              <span title="อายุราชการ">รับราชการ ${person.years_service ?? '-'}ปี</span>
                              <span title="อายุครองยศ">ครองยศ ${person.years_in_rank ?? '-'}ปี</span>
                            </div>
                          </div>
                        </div>
                        <div class="tp-cand-right">
                          <div class="tp-cond-score ${cr.allPass ? 'all-pass' : ''}">${cr.passCount}/${cr.totalChecks}</div>
                          <div class="tp-cond-checks">
                            ${cr.checks.map((c, i) => html`
                              <span key=${i} class="tp-cond-dot ${c.pass ? 'pass' : 'fail'}" title="${c.label}: ${c.req} -> ${c.val}">
                                ${c.pass ? 'v' : 'x'}
                              </span>
                            `)}
                          </div>
                          <button class="tp-sim-btn" onClick=${() => addSimulation(person, selectedSlot)} title="จำลองการย้าย">+</button>
                        </div>
                      </div>
                    `;
                  })}
                  ${filtered.length > 80 ? html`<div class="tp-empty">แสดง 80 จาก ${filtered.length} คน</div>` : null}
                  ${filtered.length === 0 ? html`<div class="tp-empty">ไม่พบผู้ผ่านเงื่อนไข</div>` : null}
                </div>
              `;
            })()}
          ` : html`
            <div class="tp-empty-state">
              <div class="tp-empty-icon">?</div>
              <h3>เลือกตำแหน่งว่าง</h3>
              <p>คลิกตำแหน่งว่างจากด้านซ้ายเพื่อดูผู้มีคุณสมบัติเหมาะสม</p>
              <p style=${{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>อ้างอิงเงื่อนไขจากอัตราหมายเลข 1310 ยก.ทหาร</p>
            </div>
          `}
        </div>
      </div>

      <!-- Simulation Panel -->
      ${simulations.length > 0 ? html`
        <div class="tp-sim-panel">
          <h3 class="tp-panel-title">จำลองการปรับย้าย (${simulations.length} รายการ)</h3>
          <div class="tp-sim-list">
            ${simulations.map(sim => html`
              <div key=${sim.id} class="tp-sim-item ${sim.result.blocked ? 'sim-blocked' : sim.result.allPass ? 'sim-pass' : 'sim-warn'}">
                <div class="tp-sim-flow">
                  <div class="tp-sim-person">
                    <strong>${sim.person.name}</strong>
                    <span>${sim.person.rank_req} | ${sim.person.position}</span>
                  </div>
                  <div class="tp-sim-arrow">>></div>
                  <div class="tp-sim-target">
                    <strong>${sim.slot.position}</strong>
                    <span>ต้องการ: ${sim.slot.rank_req}</span>
                  </div>
                </div>
                <div class="tp-sim-checks">
                  ${sim.result.checks.map((c, i) => html`
                    <div key=${i} class="tp-sim-check ${c.pass ? 'pass' : 'fail'}">
                      <span class="tp-sim-check-icon">${c.pass ? 'v' : 'x'}</span>
                      <span>${c.label}: ${c.req}</span>
                      <span class="tp-sim-check-val">${c.val}</span>
                    </div>
                  `)}
                </div>
                <div class="tp-sim-result">
                  <span class=${sim.result.blocked ? 'sim-result-blocked' : sim.result.allPass ? 'sim-result-pass' : 'sim-result-fail'}>
                    ${sim.result.blocked ? 'ห้ามย้าย (ยศสูงกว่าตำแหน่ง)' : sim.result.allPass ? 'ผ่านทุกเงื่อนไข' : `ไม่ผ่าน ${sim.result.totalChecks - sim.result.passCount} เงื่อนไข`}
                  </span>
                  <button class="tp-sim-remove" onClick=${() => removeSimulation(sim.id)}>ลบ</button>
                </div>
              </div>
            `)}
          </div>
        </div>
      ` : null}

      <!-- Transfer Rules Reference -->
      <div class="tp-rules-ref">
        <h3 class="tp-panel-title">เงื่อนไขการปรับย้าย (อัตราหมายเลข 1310)</h3>
        <div class="tp-rules-grid">
          ${TRANSFER_RULES.map(rule => html`
            <div key=${rule.id} class="tp-rule-card">
              <div class="tp-rule-id">${rule.id}</div>
              <div class="tp-rule-body">
                <div class="tp-rule-name">${rule.name}</div>
                <div class="tp-rule-desc">${rule.desc}</div>
                <div class="tp-rule-conds">
                  ${rule.conditions.map((c, i) => html`
                    <span key=${i} class="tp-rule-cond">${c.label}: ${c.req}</span>
                  `)}
                </div>
              </div>
            </div>
          `)}
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
          <button class="nav-tab ${tab === 'transfer' ? 'active' : ''}" onClick=${() => setTab('transfer')}>เตรียมย้าย</button>
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
          ${tab === 'transfer' ? html`
            <${TransferPrepView} data=${data}
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
