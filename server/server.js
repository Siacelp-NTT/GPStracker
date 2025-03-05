const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const net = require("net");

const app = express();
const port = 89;
app.use(express.json());
app.use(cors());
app.use(express.static("public"));


// Database Setup
const db = new sqlite3.Database("./iot-tracking.db", (err) => {
    if (err) console.error("Database error:", err);
    else console.log("Connected to SQLite database");
});

// Create Users Table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

// Create Tracking Table
db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    lat REAL,
    lon REAL,
    speed REAL,
    timestamp TEXT
)`);

// GPS2IP Socket Connection
const PHONE_IP = "172.16.133.137"; // Replace with your actual iPhone IP
const GPS2IP_PORT = 11123; // Make sure this matches your GPS2IP app settings

const client = new net.Socket();
client.connect(GPS2IP_PORT, PHONE_IP, () => {
    console.log("✅ Connected to GPS2IP Socket!");
});

client.on("data", (data) => {
    const gpsString = data.toString().trim();
    console.log("📍 Raw GPS Data:", gpsString);

    if (gpsString.startsWith("$GPRMC")) {
        const parsedData = parseGPRMC(gpsString);
        if (parsedData) {
            console.log("✅ Parsed GPS Data:", parsedData);
            saveToDatabase(parsedData);
        }
    }
});

client.on("error", (err) => {
    console.error("❌ Socket error:", err.message);
});

client.on("close", () => {
    console.log("❌ Connection to GPS2IP closed");
});

// Parse GPS Data from GPRMC format
function parseGPRMC(sentence) {
    const parts = sentence.split(",");
    
    if (parts.length < 12) return null; // Ensure we have all necessary data
    
    const timeUTC = parts[1]; 
    const status = parts[2]; // "A" means valid, "V" means void
    const latRaw = parts[3];
    const latDir = parts[4];
    const lonRaw = parts[5];
    const lonDir = parts[6];
    const speedKnots = parseFloat(parts[7]);
    const dateRaw = parts[9];

    if (status !== "A") return null; // Skip if data is invalid

    // Convert lat/lon from "DDMM.MMMM" format to decimal degrees
    const latitude = convertToDecimal(latRaw, latDir);
    const longitude = convertToDecimal(lonRaw, lonDir);

    // Convert speed from knots to km/h
    const speedKmh = speedKnots * 1.852;

    // Format UTC time and date
    const formattedTime = `${timeUTC.slice(0, 2)}:${timeUTC.slice(2, 4)}:${timeUTC.slice(4, 6)} UTC`;
    const formattedDate = `20${dateRaw.slice(4, 6)}-${dateRaw.slice(2, 4)}-${dateRaw.slice(0, 2)}`;

    return {
        time: formattedTime,
        date: formattedDate,
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
        speed: speedKmh.toFixed(2)
    };
}

// Convert coordinates to decimal
function convertToDecimal(raw, direction) {
    const degrees = parseInt(raw.slice(0, -7), 10);
    const minutes = parseFloat(raw.slice(-7));
    let decimal = degrees + (minutes / 60);
    if (direction === "S" || direction === "W") decimal *= -1;
    return decimal;
}

// Store GPS Data in Database
function saveToDatabase(data) {
    db.run(
        `INSERT INTO tracking (userId, lat, lon, speed, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`,
        [1, data.latitude, data.longitude, data.speed], // Assuming user ID 1 for now
        (err) => {
            if (err) console.error("❌ Database Insert Error:", err.message);
            else console.log("✅ GPS Data saved to database.");
        }
    );
}

// Register User (No Password Hashing)
app.post("/register", (req, res) => {
    const { username, password } = req.body;

    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, 
        [username, password], 
        (err) => {
            if (err) return res.status(400).json({ message: "Username already exists" });
            res.json({ message: "User registered successfully" });
        }
    );
});

// Login User (No Password Hashing)
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, 
        [username, password], 
        (err, user) => {
            if (err || !user) return res.status(401).json({ message: "Invalid username or password" });

            res.json({ message: "Login successful", userId: user.id });
        }
    );
});

// Get Latest GPS Data
app.get("/gps/latest", (req, res) => {
    db.get(`SELECT * FROM tracking ORDER BY id DESC LIMIT 1`, (err, row) => {
        if (err || !row) return res.status(500).json({ message: "No GPS data available" });
        res.json(row);
    });
});

// Get Weekly Report for a User
app.get("/weekly-report/:userId", (req, res) => {
    const { userId } = req.params;

    db.all(
        `SELECT * FROM tracking 
         WHERE userId = ? 
         AND timestamp >= datetime('now', '-7 days') 
         ORDER BY timestamp ASC`,
        [userId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ message: "Error retrieving weekly report" });
            }
            res.json({ weeklyReport: rows });
        }
    );
});

// Default Route
app.get("/", (req, res) => {
    res.send("🚀 Server is running! Use API endpoints.");
});

// Start Server
app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});
