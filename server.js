const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from the root directory
app.use(express.static(path.join(__dirname, ".")));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});