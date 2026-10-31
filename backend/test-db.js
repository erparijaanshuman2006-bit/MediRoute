
require("dotenv").config();
const pool = require("./db");

async function testConnection() {
    try {
        const result = await pool.query(
            "SELECT current_database() AS database, NOW() AS time"
        );

        console.log("PostgreSQL connected successfully!");
        console.log("Database:", result.rows[0].database);
    } catch (error) {
        console.error("Connection failed:", error.message);
    } finally {
        await pool.end();
    }
}

testConnection();
