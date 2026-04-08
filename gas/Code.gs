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
 * study_field, birth_be, years_in_rank
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

  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    if (obj.id) rows.push(obj);
  }

  return { data: rows, count: rows.length };
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
          'birth_be', 'years_in_rank', 'position_detail', 'study_field'];
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
