const Database = require("better-sqlite3");

const db = new Database("visitors.db");

// Create the counter the first time the server runs.
db.exec(
    CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
    )
);

db.prepare(
    INSERT OR IGNORE INTO counters (name, value)
    VALUES ('visitors', 0)
).run();

const incrementVisitor = db.prepare(
    UPDATE counters
    SET value = value + 1
    WHERE name = 'visitors'
);

const getVisitors = db.prepare(
    SELECT value FROM counters
    WHERE name = 'visitors'
);
then app this to your endpoints
app.get("/api/visitor-count", (req, res) => {
    incrementVisitor.run();

    const row = getVisitors.get();

    res.json({
        visitors: row.value
    });
});