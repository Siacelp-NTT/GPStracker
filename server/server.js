const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const fetch = require("node-fetch"); // Install with: npm install node-fetch

const app = express();
const port = 89; // Changed to 89
app.use(express.json());
app.use(cors());

// Database Setup
const db = new sqlite3.Database("./iot-tracking.db", (err) => {
    if (err) console.error("Database error:", err);
    else console.log("Connected to SQLite database");
});

// Create Users and Tracking Tables
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    lat REAL,
    lon REAL,
    timestamp TEXT
)`);

// Replace with your actual phone IP running GPS2IP
const PHONE_IP = "192.168.1.100"; // Change this to your phone’s actual IP
const GPS2IP_PORT = 2222; // GPS2IP default port

// Function to fetch GPS data from GPS2IP
async function getGPSData() {
    try {
        const response = await fetch(`http://${PHONE_IP}:${GPS2IP_PORT}/?format=json`);
        const data = await response.json();
        if (data && data.lat && data.lon) {
            return { lat: parseFloat(data.lat), lon: parseFloat(data.lon) };
        }
    } catch (error) {
        console.error("Error fetching GPS data:", error);
    }
    return null;
}

// Haversine formula to calculate distance between two GPS points
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

// Register User
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

// Login User
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, 
        [username, password], 
        (err, user) => {
            if (err || !user) return res.status(401).json({ message: "Invalid credentials" });
            res.json({ message: "Login successful", userId: user.id });
        }
    );
});

// Store GPS Data
app.post("/gps", async (req, res) => {
    const { userId } = req.body; // User ID comes from frontend
    const gpsData = await getGPSData();
    
    if (!gpsData) {
        return res.status(500).json({ message: "Failed to fetch GPS data from GPS2IP" });
    }

    const { lat, lon } = gpsData;
    db.run(
        `INSERT INTO tracking (userId, lat, lon, timestamp) VALUES (?, ?, ?, datetime('now'))`, 
        [userId, lat, lon],
        (err) => {
            if (err) return res.status(500).json({ message: "Error storing GPS data" });
            res.json({ message: "GPS data stored", lat, lon });
        }
    );
});

// Get Weekly Report for Distance and Calories
app.get("/report/:userId", (req, res) => {
    const userId = req.params.userId;
    db.all(
        `SELECT * FROM tracking WHERE userId = ? AND timestamp >= date('now', '-7 days')`, 
        [userId], 
        (err, rows) => {
            if (err) return res.status(500).json({ message: "Error fetching report" });

            let totalDistance = 0;
            for (let i = 1; i < rows.length; i++) {
                totalDistance += haversine(rows[i - 1].lat, rows[i - 1].lon, rows[i].lat, rows[i].lon);
            }
            const caloriesBurned = totalDistance * 60; // Approximate calories burned

            res.json({ totalDistance, caloriesBurned });
        }
    );
});

// Start Server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
