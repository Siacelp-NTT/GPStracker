const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const port = 89;
const db = new sqlite3.Database("users.db");

app.use(cors());
app.use(bodyParser.json());

// Create Users Table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

// Register Route
app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, 
        [username, hashedPassword], 
        function (err) {
            if (err) return res.status(400).json({ message: "User already exists" });
            res.json({ message: "User registered" });
        }
    );
});

// Login Route
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user) return res.status(400).json({ message: "User not found" });

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ message: "Invalid credentials" });

        res.json({ message: "Login successful", userId: user.id });
    });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
