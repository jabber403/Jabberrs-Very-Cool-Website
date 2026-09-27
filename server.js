const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------
// SQLite Setup
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
// Visitor Counter APIs
// --------------------

// Increments the count (used for brand new sessions)
app.get("/api/visitor-count", (req, res) => {
    incrementVisitor.run();
    const row = getVisitors.get();
    res.json({
        visitors: row ? row.value : 0
    });
});

// Gets the count WITHOUT incrementing (used for page refreshes in the same session)
app.get("/api/visitor-count-view", (req, res) => {
    const row = getVisitors.get();
    res.json({
        visitors: row ? row.value : 0
    });
});

// --------------------
// Static Website Files
// --------------------

app.use(express.static(path.join(__dirname, ".")));

// --------------------
// Start Server
// --------------------

app.listen(PORT, () => {
    console.log(`Website running on http://localhost:${PORT}`);
});