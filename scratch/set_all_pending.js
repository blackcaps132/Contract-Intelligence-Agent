const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/data/contracts.db');

// All contracts with no analysis start in 'Pending Review'
db.exec("UPDATE contracts SET status = 'Pending Review' WHERE checklist_score IS NULL;");

const rows = db.prepare('SELECT id, title, checklist_score, status FROM contracts').all();
console.table(rows);
