import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME ,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+05:30',
  charset: 'utf8mb4',
});

// Verify connectivity on startup
pool.getConnection()
  .then((conn) => {
    console.log('✅ MySQL connected successfully');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ MySQL connection error:', err.message);
  });

export default pool;