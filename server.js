import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { neon } from '@neondatabase/serverless';

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const sql = neon(databaseUrl);
const sseClients = new Set();

app.use(cors());
app.use(express.json({ limit: '50kb' }));

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS account_hashes (
      hash TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

async function getUserCount() {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM account_hashes;`;
  return rows[0]?.count || 0;
}

function broadcastCount(count) {
  const payload = `data: ${JSON.stringify({ count })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/count', async (_req, res) => {
  try {
    const count = await getUserCount();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

app.get('/api/account-hashes/:hash', async (req, res) => {
  const hash = String(req.params.hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid SHA-256 hash' });
  }

  try {
    const rows = await sql`SELECT 1 AS found FROM account_hashes WHERE hash = ${hash} LIMIT 1;`;
    return res.json({ exists: rows.length > 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check hash' });
  }
});

app.post('/api/account-hashes', async (req, res) => {
  const hash = String(req.body?.hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid SHA-256 hash' });
  }

  try {
    await sql`
      INSERT INTO account_hashes (hash)
      VALUES (${hash})
      ON CONFLICT (hash) DO NOTHING;
    `;

    const count = await getUserCount();
    broadcastCount(count);

    return res.json({ ok: true, count });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to store hash' });
  }
});

app.get('/api/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  try {
    const count = await getUserCount();
    res.write(`data: ${JSON.stringify({ count })}\n\n`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ count: 0 })}\n\n`);
  }

  req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
