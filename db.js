const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'wecount',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Get a promise-based connection from the pool
const getConnection = async () => {
  return await pool.getConnection();
};

module.exports = {
  query: async (sql, params) => {
    // Ensure params is not undefined before executing
    if (params === undefined) {
        console.error('DB Query Error: Params are undefined for SQL:', sql);
        // Throw an error or handle appropriately
        throw new Error('Query parameters cannot be undefined.');
    }
    // Log the parameters being passed to pool.execute
    console.log('[DB Query] Preparing to execute SQL:', sql);
    console.log('[DB Query] With Params (type):', typeof params);
    console.log('[DB Query] With Params (content):', JSON.stringify(params, null, 2)); // Pretty print for readability
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('[DB Query] Error executing query:', error);
        console.error('[DB Query] SQL:', sql);
        console.error('[DB Query] Params that caused error:', JSON.stringify(params, null, 2));
        // Re-throw the error to be caught by the calling function
        throw error;
    }
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
  },
  getConnection
};