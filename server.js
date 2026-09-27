const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = 3000;

// --------------------
// SQLite
// --------------------

const db = new Database("visitors.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
    )
`);

db.prepare(`
    INSERT OR IGNORE INTO counters (name, value)
    VALUES ('visitors', 0)
`).run();

const incrementVisitor = db.prepare(`
    UPDATE counters
    SET value = value + 1
    WHERE name = 'visitors'
`);

const getVisitors = db.prepare(`
    SELECT value
    FROM counters
    WHERE name = 'visitors'
`);

// --------------------
// Visitor counter API
// --------------------

app.get("/api/visitor-count", (req, res) => {
    incrementVisitor.run();

    const row = getVisitors.get();

    res.json({
        visitors: row.value
    });
});

// --------------------
// Static website (pointing to root directory)
// --------------------

app.use(express.static(path.join(__dirname, ".")));

// --------------------
// Start server
// --------------------

app.listen(PORT, () => {
    console.log(`Website running on http://localhost:${PORT}`);
});