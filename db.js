const mysql = require('mysql2/promise');
require('dotenv').config();


/*nst pool = mysql.createPool({
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
database: process.env.DB_NAME || 'wecount',
port: process.env.DB_PORT || 3306,
waitForConnections: true
});*/

const pool = mysql.createPool({
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
database: process.env.DB_NAME || 'wecount',
port: process.env.DB_PORT || 3306,
waitForConnections: true,
ssl: {
  rejectUnauthorized: false  // Allow self-signed certificates
},
connectionLimit: 10,
queueLimit: 0,
connectTimeout: 60000
});


/*console.log(process.env.DB_HOST);
const pool = mysql.createPool({
  host: 'mysql-34b2dc40-ala-ff3b.f.aivencloud.com',
  user: 'avnadmin',
  password: 'AVNS_FJeqAnK-TVYrzmalQn4',
  database: 'wecount',
  waitForConnections: true,
  port: 21099,
  ssl: {
    rejectUnauthorized: false  // Allow self-signed certificates
  },
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000
});*/



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