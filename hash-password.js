// hash-password.js - Run this once to generate password hash
const bcrypt = require("bcrypt");

async function generateHash() {
  // Change 'admin123' to your desired password
  const password = "admin123";

  try {
    const hash = await bcrypt.hash(password, 10);
    console.log("\n=================================");
    console.log("Password:", password);
    console.log("Hash:", hash);
    console.log("=================================\n");
    console.log("Copy this hash into your SQL INSERT statement:\n");
    console.log(`INSERT INTO users (username, email, password_hash, role, is_active) 
VALUES ('admin', 'admin@example.com', '${hash}', 'admin', true);`);
    console.log("\n");
  } catch (err) {
    console.error("Error generating hash:", err);
  }
}

generateHash();
