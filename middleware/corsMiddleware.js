// CORS middleware configuration
const cors = require('cors');

const corsOptions = {
  origin: '*', // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*', // Allow all headers
  exposedHeaders: ['Set-Cookie', 'X-Json', 'Content-Type']
};

// Primary CORS middleware
const corsMiddleware = cors(corsOptions);

// Secondary middleware to ensure headers are set on all responses
const additionalCorsHeaders = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
};

// Handle preflight OPTIONS requests
const optionsCorsHandler = cors(corsOptions);

module.exports = {
  corsMiddleware,
  additionalCorsHeaders,
  optionsCorsHandler
};
