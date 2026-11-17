// One-time recovery of A1 comments from the original daily-plan workbooks.
// Run: node scripts/import-excel-a1-comments.js [--dry-run]
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SOURCE = 'D:\\Download\\Files\\Master\\Plan 每日计划';
const MEMORY = 'D:\\Download\\Tool\\rizhi\\memory';
const dryRun = process.argv.includes('--dry-run');

function iso(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`无效日期：${year}.${month}.${day}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function workbookRange(name) {
  const match = name.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s*-\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) throw new Error(`无法解析文件日期：${name}`);
  return { start: iso(+match[1], +match[2], +match[3]), end: iso(+match[4], +match[5], +match[6]) };
}

function sheetDate(yearRange, month, day) {
  const startYear = +yearRange.start.slice(0, 4);
  const endYear = +yearRange.end.slice(0, 4);
  const dates = [...new Set([startYear, endYear])]
    .map((year) => iso(year, month, day))
    .filter((date) => date >= yearRange.start && date <= yearRange.end);
  if (dates.length !== 1) throw new Error(`工作表日期不在文件范围内：${month}.${day}`);
  return dates[0];
}

function parseSheetRange(name, yearRange) {
  const match = name.replace(/\s/g, '').match(/^(\d{1,2})\.(\d{1,2})(?:-(?:(\d{1,2})\.)?(\d{1,3}))?$/);
  if (!match) throw new Error(`无法解析工作表名称：${name}`);
  const month = +match[1];
  const start = sheetDate(yearRange, month, +match[2]);
  if (!match[4]) return { start, end: start };
  // One original sheet is named "7.26-727"; this denotes July 26–27.
  const endMonth = match[3] ? +match[3] : month;
  const endDay = match[4].length === 3 && match[4].startsWith(String(endMonth))
    ? +match[4].slice(String(endMonth).length)
    : +match[4];
  const end = sheetDate(yearRange, endMonth, endDay);
  if (end < start) throw new Error(`工作表日期范围倒置：${name}`);
  return { start, end };
}

function commentBody(comments) {
  return comments.map((comment) => {
    const text = String(comment.t || '').replace(/\r\n/g, '\n');
    const author = String(comment.a || '').trim();
    const prefix = `${author}:\n`;
    return author && text.startsWith(prefix) ? text.slice(prefix.length).trim() : text.trim();
  }).filter(Boolean).join('\n\n');
}

function monthKeys(start, end) {
  const keys = [];
  const cursor = new Date(+start.slice(0, 4), +start.slice(5, 7) - 1, 1);
  const finish = end.slice(0, 7);
  while (true) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    keys.push(key);
    if (key === finish) return keys;
    cursor.setMonth(cursor.getMonth() + 1);
  }
}

function run() {
  if (!fs.statSync(SOURCE).isDirectory() || !fs.statSync(MEMORY).isDirectory()) {
    throw new Error('来源目录或日织 memory 目录不存在，已停止导入。');
  }
  const files = fs.readdirSync(SOURCE).filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$')).sort();
  const entries = [];
  let empty = 0;
  for (const name of files) {
    const range = workbookRange(name);
    const workbook = XLSX.readFile(path.join(SOURCE, name), { cellComments: true });
    for (const sheetName of workbook.SheetNames) {
      const comments = workbook.Sheets[sheetName].A1?.c;
      if (!comments?.length) continue;
      const content = commentBody(comments);
      if (!content) { empty++; continue; }
      const dates = parseSheetRange(sheetName, range);
      entries.push({
        id: `journal-excel-a1-${dates.start}${dates.end === dates.start ? '' : `-${dates.end}`}`,
        date: dates.start,
        dateRangeStart: dates.end === dates.start ? '' : dates.start,
        dateRangeEnd: dates.end === dates.start ? '' : dates.end,
        sheetName,
        content,
        tagIds: [],
        media: [],
        source: 'excel-a1-comment',
        updatedAt: new Date().toISOString()
      });
    }
  }
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`重复日期：${entry.id}`);
    ids.add(entry.id);
  }
  const months = new Map();
  for (const entry of entries) {
    for (const month of monthKeys(entry.date, entry.dateRangeEnd || entry.date)) {
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(entry);
    }
  }
  let added = 0;
  let unchanged = 0;
  for (const [month, journals] of months) {
    const folder = path.join(MEMORY, month);
    const file = path.join(folder, `rizhi-data-${month}.json`);
    const data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { version: 2, month, tasks: [], journals: [], profile: {}, updatedAt: new Date().toISOString() };
    if (!Array.isArray(data.journals) || !Array.isArray(data.tasks)) throw new Error(`月度文件格式异常：${file}`);
    let changed = false;
    for (const journal of journals) {
      const existing = data.journals.find((item) => item.id === journal.id);
      if (existing) { unchanged++; continue; }
      if (data.journals.some((item) => item.date === journal.date && item.content === journal.content)) {
        unchanged++; continue;
      }
      data.journals.push(journal);
      added++;
      changed = true;
    }
    if (!changed || dryRun) continue;
    data.updatedAt = new Date().toISOString();
    fs.mkdirSync(folder, { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-excel-import.bak`);
    const temp = `${file}.import-tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, file);
  }
  console.log(JSON.stringify({ workbooks: files.length, journalEntries: entries.length, emptyComments: empty, months: months.size, added, unchanged, dryRun, memory: MEMORY }, null, 2));
}

run();
