
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const { getJwtSecret } = require('./config/environment');
const apiRoutes = require('./routes/api');
const {
  authRateLimit,
  requestRateLimit,
} = require('./middleware/rateLimit');

const app = express();

app.disable('x-powered-by');

/* =========================================
   CORS CONFIGURATION
========================================= */

const allowedOrigins = (
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  ''
)
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      const normalizedOrigin = origin
        ? origin.replace(/\/+$/, '')
        : '';

      const isLocalDevelopmentOrigin =
        process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(
          normalizedOrigin
        );

      if (
        !origin ||
        allowedOrigins.includes(normalizedOrigin) ||
        isLocalDevelopmentOrigin
      ) {
        return callback(null, true);
      }

      const error = new Error(
        'This frontend origin is not allowed by the server CORS policy.'
      );

      error.status = 403;

      return callback(error);
    },
  })
);

app.use(express.json({ limit: '1mb' }));

/* =========================================
   ENVIRONMENT & DATABASE INITIALIZATION
========================================= */

// Reuse a pending/successful database connection
// across requests handled by the same instance.
let dbReadyPromise = null;

async function ensureReady() {
  const jwtSecret = getJwtSecret();

  if (
    !jwtSecret ||
    jwtSecret.length < 32 ||
    /replace|change.?me|example/i.test(jwtSecret)
  ) {
    throw new Error(
      'Set SECRET_KEY or JWT_SECRET to a private random value of at least 32 characters.'
    );
  }

  if (!dbReadyPromise) {
    dbReadyPromise = Promise.resolve()
      .then(() => connectDB())
      .catch((error) => {
        // Allow a later request to retry if connection fails.
        dbReadyPromise = null;
        throw error;
      });
  }

  await dbReadyPromise;
}

/* =========================================
   HEALTH CHECK
========================================= */

app.get('/health', async (req, res) => {
  try {
    await ensureReady();

    return res.status(200).json({
      status: 'ok',
    });
  } catch (error) {
    console.error(
      'Health check failed:',
      error.message
    );

    return res.status(503).json({
      status: 'error',
      message:
        'API unavailable. Check environment variables and database connectivity.',
    });
  }
});

/* =========================================
   RATE LIMITING
========================================= */

app.use('/api/auth/login', authRateLimit);

app.use('/api/ai', requestRateLimit);

/* =========================================
   DATABASE READY CHECK FOR API REQUESTS
========================================= */

app.use('/api', async (req, res, next) => {
  try {
    await ensureReady();
    return next();
  } catch (error) {
    console.error(
      'API initialization failed:',
      error.message
    );

    return res.status(503).json({
      error:
        'API temporarily unavailable. Check database connectivity and environment variables.',
    });
  }
});

/* =========================================
   API ROUTES
========================================= */

app.use('/api', apiRoutes);

/* =========================================
   404 HANDLER
========================================= */

app.use((req, res) => {
  return res.status(404).json({
    error: 'Route not found.',
  });
});

/* =========================================
   GLOBAL ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Request body contains invalid JSON.',
    });
  }

  console.error('Request failed:', err.message);

  return res.status(err.status || 500).json({
    error:
      err.status
        ? err.message
        : 'An unexpected server error occurred.',
  });
});

/* =========================================
   LOCAL DEVELOPMENT SERVER
========================================= */

// Vercel imports the Express app.
// Locally, `node src/server.js` starts a normal server.
async function startServer() {
  try {
    await ensureReady();

    const port = Number(process.env.PORT) || 5000;

    app.listen(port, () => {
      console.log(
        `HCM Lite API listening on port ${port}`
      );
    });
  } catch (error) {
    console.error(
      'Unable to start HCM Lite API:',
      error.message
    );

    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer();
}

/* =========================================
   EXPORT EXPRESS APP FOR VERCEL
========================================= */

module.exports = app;

// Retain compatibility with code using named imports.
module.exports.app = app;
module.exports.startServer = startServer;
