require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { getJwtSecret } = require('./config/environment');
const apiRoutes = require('./routes/api');
const { authRateLimit, requestRateLimit } = require('./middleware/rateLimit');

const app = express();
app.disable('x-powered-by');

const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin))) {
      callback(null, true);
      return;
    }
    const denied = new Error('This frontend origin is not allowed by the server CORS policy.');
    denied.status = 403;
    callback(denied);
  }
}));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth/login', authRateLimit);
app.use('/api/ai', requestRateLimit);
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body contains invalid JSON.' });
  }
  console.error('Request failed:', err.message);
  return res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred.' });
});

async function startServer() {
  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret || jwtSecret.length < 32 || /replace|change.?me|example/i.test(jwtSecret)) {
      throw new Error('Set SECRET_KEY (or JWT_SECRET) to a private random value of at least 32 characters before starting the API.');
    }
    await connectDB();
    const port = Number(process.env.PORT) || 5000;
    app.listen(port, () => console.log(`HCM Lite API listening on port ${port}`));
  } catch (err) {
    console.error('Unable to start HCM Lite API:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) startServer();

module.exports = { app, startServer };