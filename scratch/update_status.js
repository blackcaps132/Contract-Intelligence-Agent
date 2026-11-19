const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/data/contracts.db');

db.exec("UPDATE contracts SET status = 'In Review' WHERE status = 'Under Review';");
db.exec("UPDATE contracts SET status = 'Active' WHERE status IN ('Executed', 'Benchmark SEC Filing');");

const rows = db.prepare('SELECT status, count(*) as count FROM contracts GROUP BY status').all();
console.log('Updated Status Counts:');
console.table(rows);
