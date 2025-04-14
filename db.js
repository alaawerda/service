const mysql = require('mysql2/promise');

/*const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'wecount',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});*/


const pool = mysql.createPool({
  host: 'mysql-34b2dc40-ala-ff3b.f.aivencloud.com',
  user: 'avnadmin',
  password: 'AVNS_FJeqAnK-TVYrzmalQn4',
  database: 'wecount',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
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