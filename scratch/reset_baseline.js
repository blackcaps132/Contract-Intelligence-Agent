const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/data/contracts.db');

db.exec("UPDATE contracts SET checklist_score = NULL, checklist_json = '[]', risk_flags_json = '[]'");

const rows = db.prepare('SELECT id, checklist_score, status FROM contracts').all();
console.table(rows);
