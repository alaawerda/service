const mysql = require('mysql2/promise');
require('dotenv').config();


/*const pool = mysql.createPool({
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
database: process.env.DB_NAME || 'wecount',
port: process.env.DB_PORT || 3306,
waitForConnections: true
});*/

/*const pool = mysql.createPool({
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
database: process.env.DB_NAME || 'wecount',
port: process.env.DB_PORT || 3306,
waitForConnections: true,
ssl: process.env.DB_HOST && process.env.DB_HOST.includes('aivencloud') ? {
  rejectUnauthorized: false  // Allow self-signed certificates
} : false,
connectionLimit: 10,
queueLimit: 0,
connectTimeout: 60000
});*/


console.log(process.env.DB_HOST);
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-34b2dc40-ala-ff3b.f.aivencloud.com',
  user: process.env.DB_USER || 'avnadmin',
  password: process.env.DB_PASSWORD || 'AVNS_FJeqAnK-TVYrzmalQn4',
  database: process.env.DB_NAME || 'wecount',
  waitForConnections: true,
  port: process.env.DB_PORT || 21099,
  ssl: process.env.DB_SSL ? JSON.parse(process.env.DB_SSL) : {
    rejectUnauthorized: false  // Allow self-signed certificates
  },
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000
});



module.exports = {
  query: async (sql, params) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  beginTransaction: async () => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    return connection;
  },
  commit: async (connection) => {
    await connection.commit();
    connection.release();
  },
  rollback: async (connection) => {
    await connection.rollback();
    connection.release();
  }
};