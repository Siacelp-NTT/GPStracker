const sqlite3 = require("sqlite3").verbose();
const express = require("express");
const session = require("express-session");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const http = require("http");
const dotenv = require("dotenv");

dotenv.config(); // Load environment variables from .env file

const app = express();
const port = process.env.SERVER_PORT || 89;
const net = require("net");
const SQLiteStore = require("connect-sqlite3")(session);

app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const sessionStore = new SQLiteStore({ db: "sessions.sqlite" });

app.use(session({
    store: sessionStore,
    secret: "your_secret_key", // Change this to a secure secret
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 60 * 1000 } // Set session expiration to 30 minutes
}));

const db = new sqlite3.Database("./iot-tracking.db", (err) => {
    if (err) {
        console.error("Database connection error:", err.message);
    } else {
        console.log("Connected to SQLite database.");
    }
});

// Clear session data on server restart
sessionStore.clear((err) => {
    if (err) {
        console.error("Error clearing session data:", err.message);
    } else {
        console.log("Session data cleared on server restart.");
    }
});

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

// Create Users Table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
)`);

// Create Tracking Table (for storing GPS data)
db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    distance REAL DEFAULT 0, -- Distance traveled (in km)
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
)`);

// Add an index on the userId column for better performance
db.run(`CREATE INDEX IF NOT EXISTS idx_userId ON tracking (userId)`);

app.get("/fetch-gps", (req, res) => {
    const { ip, port } = req.query;
    const gpsPort = port || 11123; // Use default port if not provided

    console.log(`Connecting to GPS2IP at ${ip}:${gpsPort}`);

    const client = new net.Socket();
    let responseData = "";

    client.setTimeout(5000); // Set timeout (5 seconds)

    client.connect(gpsPort, ip, () => {
        console.log("Connected to GPS2IP, requesting data...");
        client.write("GET /?request=live\r\n");  // Send request manually
    });

    client.on("data", (data) => {
        responseData += data.toString();
        console.log("Received GPS Data:", responseData);
        client.end(); // Close connection after receiving data
    });

    client.on("end", () => {
        console.log("Connection ended. Sending response...");
        res.send(responseData || '{"error":"No data received"}');
    });

    client.on("timeout", () => {
        console.error("Connection timed out!");
        res.status(500).json({ error: "Connection timed out" });
        client.destroy();
    });

    client.on("error", (err) => {
        console.error("Socket Error:", err.message);
        res.status(500).json({ error: "Failed to fetch GPS data", details: err.message });
        client.destroy();
    });

    client.on("close", () => {
        console.log("Connection closed.");
    });
});

app.post("/update-location", (req, res) => {
    const { userId, lat, lon } = req.body;

    if (!userId || !lat || !lon) {
        return res.status(400).json({ error: "Missing required data" });
    }

    db.get(
        `SELECT lat, lon, distance FROM tracking WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`,
        [userId],
        (err, lastLocation) => {
            if (err) {
                console.error("Database fetch error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            let newDistance = 0;
            if (lastLocation) {
                const distance = haversine(parseFloat(lastLocation.lat), parseFloat(lastLocation.lon), parseFloat(lat), parseFloat(lon));
                newDistance = lastLocation.distance + distance;
                console.log(`Last Location: (${lastLocation.lat}, ${lastLocation.lon})`);
                console.log(`Current Location: (${lat}, ${lon})`);
                console.log(`Calculated Distance: ${distance} km`);
                console.log(`Total Distance: ${newDistance} km`);
            }

            db.run(
                `INSERT INTO tracking (userId, lat, lon, distance) VALUES (?, ?, ?, ?)`,
                [userId, lat, lon, newDistance],
                function (err) {
                    if (err) {
                        console.error("Database insert error:", err.message);
                        return res.status(500).json({ error: "Database error" });
                    }
                    res.json({ message: "Location updated successfully", distance: newDistance });
                }
            );
        }
    );
});

// Register User (with password hashing)
app.post("/register", async (req, res) => {
    const username = req.body.username.toLowerCase();
    const password = req.body.password;

    if (!username || !password) {
        return res.json({ message: "Username and password required" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, 
            [username, hashedPassword], 
            function(err) {
                if (err) {
                    return res.json({ message: "Error registering user" });
                }
                return res.json({ message: "Registration successful" });  
            }
        );
    } catch (error) {
        return res.status(200).json({ message: "Error hashing password" });  
    }

});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username.toLowerCase()], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ error: "Internal Server Error" });
        }

        if (!user) {
            return res.json({ error: "Invalid credentials" });
        }

        try {
            const match = await bcrypt.compare(password, user.password);

            if (match) {
                req.session.userId = user.id; // Store user ID in session
                console.log("User logged in. Session userId set:", req.session.userId);

                req.session.save((saveErr) => {
                    if (saveErr) console.error("Session save error:", saveErr);
                    return res.status(200).json({ message: "Login successful", userId: user.id });
                }); 
            } else {
                return res.status(200).json({ error: "Invalid credentials" });  
            }

        } catch (compareError) {
            console.error("Bcrypt error:", compareError);
            return res.status(200).json({ error: "Internal Server Error" });  
        }
    });
});

app.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Failed to log out" });
        }
        res.json({ message: "Logout successful" });
    });
});

app.get("/api/weekly-report", (req, res) => {
    const userId = req.session.userId;

    if (!req.session.userId) {
        console.log("Unauthorized access! Redirecting to login...");
        return res.status(401).json({ error: "Unauthorized" });
    }

    const query = `
        SELECT 
            lat, lon, timestamp
        FROM tracking 
        WHERE userId = ? 
        AND timestamp >= datetime('now', '-7 days')
        ORDER BY timestamp ASC
    `;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).json({ error: "Database Error" });
        }

        if (rows.length === 0) {
            return res.json({ total_distance: 0, updates: 0, first_entry: "N/A", last_entry: "N/A" });
        }

        let totalDistance = 0;
        for (let i = 1; i < rows.length; i++) {
            totalDistance += haversine(rows[i - 1].lat, rows[i - 1].lon, rows[i].lat, rows[i].lon);
        }

        const firstEntry = rows[0].timestamp;
        const lastEntry = rows[rows.length - 1].timestamp;

        res.json({ total_distance: totalDistance, updates: rows.length, first_entry: firstEntry, last_entry: lastEntry });
    });
});

app.get("/", (req, res) => {
    res.redirect("/login");
});

app.get("/check-auth", (req, res) => {
    console.log("Session UserID:", req.session.userId)
    console.log("Checking authentication. Session ID:", req.sessionID);
    console.log("Session data:", req.session);
    if (req.session.userId) {
        res.json({ authenticated: true, userId: req.session.userId });
    } else {
        res.json({ authenticated: false });
    }
});

app.get("/dashboard/:userId", (req, res, next) => {
    const userId = req.params.userId;

    if (!req.session.userId) {
        console.log("Unauthorized access! Redirecting to login...");
        return res.redirect("/login"); // Redirect if not logged in
    }
    next();

    db.get(
        `SELECT lat, lon, distance, timestamp FROM tracking WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`,
        [userId],
        (err, row) => {
            if (err) {
                console.error("Database fetch error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            if (!row) {
                return res.status(404).json({ error: "No location data found" });
            }

            res.json(row);
        }
    );
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
});