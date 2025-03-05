const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const net = require("net");
const path = require("path");

const app = express();
const port = 89;
app.use(express.json());
app.use(cors());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));


// Database Setup
const db = new sqlite3.Database("./iot-tracking.db", (err) => {
    if (err) console.error("Database error:", err);
    else console.log("✅ Connected to SQLite database");
});

// Create Users Table (with IP Address)
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    ip_address TEXT
)`);
// Check if "ip_address" column exists, and add it if missing
db.all(`PRAGMA table_info(users)`, (err, columns) => {
    if (err) {
        console.error("❌ Error checking columns:", err);
    } else {
        const hasIpColumn = columns.some(col => col.name === "ip_address");
        if (!hasIpColumn) {
            db.run(`ALTER TABLE users ADD COLUMN ip_address TEXT`, (alterErr) => {
                if (alterErr) console.error("❌ Error adding ip_address column:", alterErr);
                else console.log("✅ Added 'ip_address' column to 'users' table");
            });
        }
    }
});


// Create Tracking Table
db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    lat REAL,
    lon REAL,
    speed REAL,
    timestamp TEXT
)`);

// Serve login page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_login.html"));
});

// Serve tracking page
app.get("/tracking", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "tracking.html"));
});

// **Register User (with IP logging)**
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    const ipAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
    }

    // Check if username exists
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (user) {
            return res.status(400).json({ message: "Username already exists" });
        }

        // Insert new user
        db.run(
            `INSERT INTO users (username, password, ip_address) VALUES (?, ?, ?)`,
            [username, password, ipAddress],
            function (err) {
                if (err) {
                    return res.status(500).json({ message: "Database error: " + err.message });
                }
                res.json({ message: "User registered successfully" });
            }
        );
    });
});

// **Login User**
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
    }

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (err) {
            return res.status(500).json({ message: "Database error: " + err.message });
        }
        if (!user) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        res.json({ message: "Login successful", userId: user.id });
    });
});

// **Get Latest GPS Data**
app.get("/gps/latest/:userId", (req, res) => {
    const userId = req.params.userId;

    db.get(`SELECT * FROM tracking WHERE userId = ? ORDER BY id DESC LIMIT 1`, [userId], (err, row) => {
        if (err) {
            return res.status(500).json({ message: "Database error: " + err.message });
        }
        if (!row) {
            return res.status(404).json({ message: "No GPS data available" });
        }

        res.json(row);
    });
});

// Start Server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://172.16.132.204:${port}`);
});

