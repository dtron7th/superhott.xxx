require('dotenv').config();

const cors = require('cors');
const express = require('express');
const { sql } = require('drizzle-orm');
const { db } = require('./db/runtime-client');

const app = express();
const PORT = Number(process.env.PORT || 3000);
let initDbPromise = null;
const sseClients = new Set();

app.use(cors());
app.use(express.json({ limit: '50kb' }));

async function initDb() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS account_hashes (
      hash TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function ensureDbInitialized() {
  if (!initDbPromise) {
    initDbPromise = initDb();
  }
  return initDbPromise;
}

async function getUserCount() {
  const result = await db.execute(sql`SELECT COUNT(*)::INT AS count FROM account_hashes`);
  const rows = Array.isArray(result) ? result : (result.rows || []);
  const row = rows[0] || {};
  return Number(row.count) || 0;
}

function broadcastCount(count) {
  const payload = `data: ${JSON.stringify({ count })}\n\n`;
  sseClients.forEach(function (client) {
    client.write(payload);
  });
}

app.get('/api/health', function (_req, res) {
  res.json({ ok: true });
});

app.get('/api/count', async function (_req, res) {
  try {
    const count = await getUserCount();
    res.json({ count: count });
  } catch (error) {
    console.error('Failed to fetch count:', error);
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

app.get('/api/account-hashes/:hash', async function (req, res) {
  const hash = String(req.params.hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid SHA-256 hash' });
  }

  try {
    const result = await db.execute(sql`
      SELECT 1 AS found
      FROM account_hashes
      WHERE hash = ${hash}
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);
    return res.json({ exists: rows.length > 0 });
  } catch (error) {
    console.error('Failed to check hash:', error);
    return res.status(500).json({ error: 'Failed to check hash' });
  }
});

app.post('/api/account-hashes', async function (req, res) {
  const hash = String(req.body && req.body.hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid SHA-256 hash' });
  }

  try {
    await db.execute(sql`
      INSERT INTO account_hashes (hash)
      VALUES (${hash})
      ON CONFLICT (hash) DO NOTHING
    `);

    const count = await getUserCount();
    broadcastCount(count);
    return res.json({ ok: true, count: count });
  } catch (error) {
    console.error('Failed to store hash:', error);
    return res.status(500).json({ error: 'Failed to store hash' });
  }
});

app.get('/api/stream', async function (req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  sseClients.add(res);

  try {
    const count = await getUserCount();
    res.write(`data: ${JSON.stringify({ count })}\n\n`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ count: 0 })}\n\n`);
  }

  req.on('close', function () {
    sseClients.delete(res);
    res.end();
  });
});

if (require.main === module) {
  ensureDbInitialized()
    .then(function () {
      app.listen(PORT, function () {
        console.log('API running on http://localhost:' + PORT);
      });
    })
    .catch(function (error) {
      console.error('Failed to initialize database:', error);
      process.exit(1);
    });
}

module.exports = {
  app,
  ensureDbInitialized
};
