const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../.env.example') }); // Load .env file securely

// Need a dedicated pool just for migrations or use .env values
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const runMigrations = async () => {
  try {
    // 1. Create migrations_log table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Read migration files
    const migrationsDir = path.join(__dirname, '../../database/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Alphabetical order

    // 3. Get already executed migrations
    const executed = await pool.query('SELECT filename FROM migrations_log');
    const executedSet = new Set(executed.rows.map(row => row.filename));

    // 4. Run new migrations
    for (const file of files) {
      if (!executedSet.has(file)) {
        console.log(`Running migration: ${file}...`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Execute migration
        try {
          await pool.query('BEGIN');
          await pool.query(sql);
          await pool.query('INSERT INTO migrations_log (filename) VALUES ($1)', [file]);
          await pool.query('COMMIT');
          console.log(`✅ Migration successful: ${file}`);
        } catch (err) {
          await pool.query('ROLLBACK');
          console.error(`❌ Migration failed: ${file}`);
          console.error(err.message);
          process.exit(1); // Stop on first failure
        }
      } else {
        console.log(`Skipping already executed migration: ${file}`);
      }
    }

    console.log('🎉 All migrations completed successfully.');
    process.exit(0);

  } catch (err) {
    console.error('Migration setup failed:', err.message);
    process.exit(1);
  }
};

runMigrations();
