// CORS middleware configuration
const cors = require('cors');

const corsOptions = {
  origin: ['https://index-one-phi.vercel.app', 'http://localhost:3000', 'http://localhost:8081', 'http://localhost:8082'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Set-Cookie', 'X-Json', 'Content-Type']
};

// Primary CORS middleware
const corsMiddleware = cors(corsOptions);

// Secondary middleware to ensure headers are set on all responses
const additionalCorsHeaders = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOptions.origin.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  const reqHeaders = req.headers['access-control-request-headers'];
  if (reqHeaders) res.header('Access-Control-Allow-Headers', reqHeaders);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
};

// Handle preflight OPTIONS requests
const optionsCorsHandler = cors(corsOptions);

module.exports = {
  corsMiddleware,
  additionalCorsHeaders,
  optionsCorsHandler
};
