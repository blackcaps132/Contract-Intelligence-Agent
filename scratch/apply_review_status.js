const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('backend/data/contracts.db');

// Set sow_002 and msa_004 to 'Needs Changes'
db.exec("UPDATE contracts SET status = 'Needs Changes' WHERE id IN ('sow_002_marketing_growth', 'msa_004_vendor_favorable');");

// Set all others to 'Pending Review'
db.exec("UPDATE contracts SET status = 'Pending Review' WHERE id NOT IN ('sow_002_marketing_growth', 'msa_004_vendor_favorable');");

const rows = db.prepare('SELECT id, title, status FROM contracts').all();
console.log('Contract Statuses:');
console.table(rows);

const counts = db.prepare('SELECT status, count(*) as count FROM contracts GROUP BY status').all();
console.log('Summary Counts:');
console.table(counts);
