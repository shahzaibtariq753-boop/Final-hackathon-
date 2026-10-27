function createRateLimit({ windowMs, max, message }) {
  const requests = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = requests.get(key);
    const current = !entry || now >= entry.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : entry;

    current.count += 1;
    requests.set(key, current);

    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    if (requests.size > 10000) {
      for (const [address, item] of requests) {
        if (now >= item.resetAt) requests.delete(address);
      }
    }

    return next();
  };
}

const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts. Please wait and try again.'
});

const requestRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many AI requests. Please try again later.'
});

module.exports = { authRateLimit, requestRateLimit };
