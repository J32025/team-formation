/**
 * Google Apps Script - Team Formation Backend
 * ============================================
 * วิธีใช้:
 * 1. เปิด Google Sheets > Extensions > Apps Script
 * 2. วางโค้ดนี้ทั้งหมดใน Code.gs
 * 3. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. คัดลอก URL ไปวางในหน้าตั้งค่าเว็บแอป
 *
 * Sheet ต้องมีชื่อ "data" และ header row ตรงกับ:
 * id, position, level, rank_req, branch, status, status_text,
 * pos_code, person_id, name, position_detail, origin, corps,
 * education, lcht_main, lcht_gen, entry_be, years_service,
 * study_field, birth_be, years_in_rank,
 * rank_date, entry_date, birth_date           ← ใหม่ (วันที่จริง)
 *
 * วิธี migrate คอลัมน์วันที่:
 *   - เปิด Apps Script editor
 *   - รันฟังก์ชัน migrateAddDateColumns() ครั้งเดียว
 *   - ฟังก์ชันจะเพิ่ม 3 คอลัมน์และ backfill ด้วยวันที่ 1 ต.ค. ของปี
 *     ที่คำนวณจาก years_service / years_in_rank เดิม
 *   - หลังจากนั้น ค่อยแก้ไขวันที่จริงทีละ row ใน Google Sheet
 */

var SHEET_NAME = 'data';

function doGet(e) {
  var action = (e.parameter && e.parameter.action) || 'getData';
  var result;

  try {
    if (action === 'getData') {
      result = getAllData();
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var result;

  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'transfer') {
      result = applyTransfers(body.transfers);
    } else if (action === 'saveAll') {
      result = saveAllData(body.data);
    } else if (action === 'updateRow') {
      result = updateRow(body.id, body.updates);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── อ่านข้อมูลทั้งหมด ──
function getAllData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return { error: 'ไม่พบ Sheet ชื่อ "' + SHEET_NAME + '"' };

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  var dateFields = { rank_date: true, entry_date: true, birth_date: true };

  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = data[i][j];
      // Serialize Date objects to ISO string (YYYY-MM-DD) for date columns
      if (dateFields[key] && val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
      }
      obj[key] = val;
    }
    if (obj.id) rows.push(obj);
  }

  return { data: rows, count: rows.length };
}

// ══════════════════════════════════════════════════════
//  MIGRATION: เพิ่มคอลัมน์ rank_date, entry_date, birth_date
//  ═══ รันครั้งเดียวจาก Apps Script editor ═══
// ══════════════════════════════════════════════════════
function migrateAddDateColumns() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบ Sheet ชื่อ "' + SHEET_NAME + '"');

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // ── หา index ของคอลัมน์ที่ต้องใช้ ──
  var colIdx = {};
  for (var i = 0; i < headers.length; i++) colIdx[headers[i]] = i;

  var required = ['entry_be', 'years_service', 'years_in_rank', 'birth_be'];
  for (var k = 0; k < required.length; k++) {
    if (colIdx[required[k]] === undefined) {
      throw new Error('ไม่พบคอลัมน์ที่จำเป็น: ' + required[k]);
    }
  }

  // ── เพิ่ม 3 คอลัมน์ใหม่ต่อท้าย (ถ้ายังไม่มี) ──
  var newCols = ['rank_date', 'entry_date', 'birth_date'];
  var added = 0;
  newCols.forEach(function(col) {
    if (colIdx[col] === undefined) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(col);
      colIdx[col] = lastCol - 1;
      added++;
    }
  });

  SpreadsheetApp.flush();

  // ── Backfill: คำนวณวันที่จาก BE year + 1 ต.ค. (ต้นปีงบ) ──
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var updates = {
    rank_date: [],
    entry_date: [],
    birth_date: []
  };

  for (var r = 0; r < data.length; r++) {
    var row = data[r];

    // rank_date ← (2569 - years_in_rank) -10-01
    var yrsInRank = Number(row[colIdx.years_in_rank]);
    var curRank = row[colIdx.rank_date];
    if (!curRank && yrsInRank > 0) {
      var rankBe = 2569 - yrsInRank;
      updates.rank_date.push({ row: r + 2, value: beYearToDateStr(rankBe) });
    }

    // entry_date ← entry_be -10-01  (หรือ 2569 - years_service)
    var entryBe = Number(row[colIdx.entry_be]);
    var yrsSrv = Number(row[colIdx.years_service]);
    var curEntry = row[colIdx.entry_date];
    if (!curEntry) {
      var eBe = entryBe > 0 ? entryBe : (yrsSrv > 0 ? 2569 - yrsSrv : 0);
      if (eBe > 0) {
        updates.entry_date.push({ row: r + 2, value: beYearToDateStr(eBe) });
      }
    }

    // birth_date ← birth_be -01-01 (default ต้นปี)
    var birthBe = Number(row[colIdx.birth_be]);
    var curBirth = row[colIdx.birth_date];
    if (!curBirth && birthBe > 0) {
      // birth_date uses Jan 1 by default (will be overwritten with real date later)
      updates.birth_date.push({ row: r + 2, value: beYearToDateStr(birthBe, 1, 1) });
    }
  }

  // ── เขียน updates ──
  Object.keys(updates).forEach(function(field) {
    var items = updates[field];
    var col = colIdx[field] + 1;
    items.forEach(function(it) {
      sheet.getRange(it.row, col).setValue(it.value);
    });
  });

  SpreadsheetApp.flush();

  return {
    success: true,
    columnsAdded: added,
    rankDatesFilled: updates.rank_date.length,
    entryDatesFilled: updates.entry_date.length,
    birthDatesFilled: updates.birth_date.length
  };
}

// แปลงปี พ.ศ. เป็นสตริงวันที่ ISO (ค.ศ.) — default = 1 ต.ค. (ต้นปีงบประมาณ)
function beYearToDateStr(beYear, month, day) {
  month = month || 10;  // default: ตุลาคม (ต้นปีงบ)
  day = day || 1;
  var ce = beYear - 543;
  var mm = ('0' + month).slice(-2);
  var dd = ('0' + day).slice(-2);
  return ce + '-' + mm + '-' + dd;
}

// ── ย้ายคน (transfer) ──
function applyTransfers(transfers) {
  if (!transfers || !transfers.length) return { error: 'ไม่มีข้อมูลการย้าย' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // สร้าง map: column name -> index
  var colMap = {};
  for (var j = 0; j < headers.length; j++) {
    colMap[headers[j]] = j;
  }

  var updated = 0;

  for (var t = 0; t < transfers.length; t++) {
    var tr = transfers[t];
    // tr = { fromId, toId, fields: { name, person_id, ... } }

    // หา row ของ toId
    for (var i = 1; i < data.length; i++) {
      if (data[i][colMap['id']] == tr.toId) {
        // อัพเดทข้อมูลคนใน target row
        var fields = tr.fields;
        for (var key in fields) {
          if (colMap[key] !== undefined) {
            sheet.getRange(i + 1, colMap[key] + 1).setValue(fields[key]);
          }
        }
        sheet.getRange(i + 1, colMap['status'] + 1).setValue(1);
        sheet.getRange(i + 1, colMap['status_text'] + 1).setValue('บรรจุจริง');
        updated++;
      }

      // ล้างข้อมูลจาก source row (ถ้ามี fromId)
      if (tr.fromId && data[i][colMap['id']] == tr.fromId) {
        var clearFields = ['name', 'person_id', 'origin', 'corps', 'education',
          'lcht_main', 'lcht_gen', 'entry_be', 'years_service',
          'birth_be', 'years_in_rank', 'position_detail', 'study_field',
          'rank_date', 'entry_date', 'birth_date'];
        for (var c = 0; c < clearFields.length; c++) {
          if (colMap[clearFields[c]] !== undefined) {
            sheet.getRange(i + 1, colMap[clearFields[c]] + 1).setValue('');
          }
        }
        sheet.getRange(i + 1, colMap['status'] + 1).setValue(0);
        sheet.getRange(i + 1, colMap['status_text'] + 1).setValue('ว่าง');
      }
    }
  }

  return { success: true, updated: updated };
}

// ── อัพเดทแถวเดียว ──
function updateRow(id, updates) {
  if (!id || !updates) return { error: 'ข้อมูลไม่ครบ' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  for (var j = 0; j < headers.length; j++) {
    colMap[headers[j]] = j;
  }

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['id']] == id) {
      for (var key in updates) {
        if (colMap[key] !== undefined) {
          sheet.getRange(i + 1, colMap[key] + 1).setValue(updates[key]);
        }
      }
      return { success: true };
    }
  }

  return { error: 'ไม่พบ id: ' + id };
}

// ── บันทึกข้อมูลทั้งหมด (overwrite) ──
function saveAllData(newData) {
  if (!newData || !newData.length) return { error: 'ไม่มีข้อมูล' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // เคลียร์ข้อมูลเดิม (เก็บ header)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clear();
  }

  // เขียนข้อมูลใหม่
  var rows = [];
  for (var i = 0; i < newData.length; i++) {
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      row.push(newData[i][headers[j]] !== undefined ? newData[i][headers[j]] : '');
    }
    rows.push(row);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { success: true, count: rows.length };
}
