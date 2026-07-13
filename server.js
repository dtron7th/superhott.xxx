require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY,
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

async function getCategories() {
  const result = await db.execute(sql`SELECT name FROM categories ORDER BY name ASC`);
  const rows = Array.isArray(result) ? result : (result.rows || []);
  return rows.map(function (row) { return row.name; });
}

async function addCategory(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  await db.execute(sql`
    INSERT INTO categories (name)
    VALUES (${normalized})
    ON CONFLICT (name) DO NOTHING
  `);
  return normalized;
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

app.get('/api/categories', async function (_req, res) {
  try {
    await ensureDbInitialized();
    const categories = await getCategories();
    return res.json({ categories: categories });
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.post('/api/categories', async function (req, res) {
  const name = req.body && req.body.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing category name' });
  }
  try {
    await ensureDbInitialized();
    const added = await addCategory(name);
    const categories = await getCategories();
    return res.json({ ok: true, added: added, categories: categories });
  } catch (error) {
    console.error('Failed to add category:', error);
    return res.status(500).json({ error: 'Failed to add category' });
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

const VIDEOS_DIR = path.join(__dirname, 'Videos');

function getVideoFiles() {
    try {
        if (!fs.existsSync(VIDEOS_DIR)) return [];
        return fs.readdirSync(VIDEOS_DIR).filter(function (file) {
            return /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(file);
        });
    } catch (error) {
        console.error('Failed to read videos directory:', error);
        return [];
    }
}

function buildTitleFromFilename(filename) {
    return filename.replace(/\.[^/.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseCost(value) {
    const str = String(value || '').trim();
    if (!str) return null;
    const match = str.replace(/[^0-9.]/g, '').match(/\d+\.?\d*/);
    return match ? parseFloat(match[0]) : null;
}

function searchVideos(query, category, access, cost) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const normalizedAccess = String(access || '').trim().toLowerCase();
    const targetCost = parseCost(cost);

    return getVideoFiles().map(function (file, index) {
        const title = buildTitleFromFilename(file);
        let accessValue = 'Free';
        let costValue = '$0.25';

        // Deterministic defaults based on filename hash.
        let hash = 0;
        for (let i = 0; i < file.length; i++) {
            hash = ((hash << 5) - hash) + file.charCodeAt(i);
            hash = hash & hash;
        }
        if (Math.abs(hash) % 3 === 0) {
            accessValue = 'Premium';
            const costs = ['$0.25', '$0.50', '$0.75', '$1.00'];
            costValue = costs[Math.abs(hash) % costs.length];
        }

        let added = '';
        try {
            const stats = fs.statSync(path.join(VIDEOS_DIR, file));
            added = stats.mtime.toISOString();
        } catch (e) {
            added = new Date().toISOString();
        }

        return {
            id: index,
            title: title,
            src: '/Videos/' + encodeURIComponent(file),
            category: 'General',
            access: accessValue,
            cost: costValue,
            added: added
        };
    }).filter(function (video) {
        if (normalizedQuery && !video.title.toLowerCase().includes(normalizedQuery)) {
            return false;
        }
        if (normalizedAccess && video.access.toLowerCase() !== normalizedAccess) {
            return false;
        }
        const videoCost = parseCost(video.cost);
        if (targetCost !== null && videoCost !== null && videoCost > targetCost) {
            return false;
        }
        return true;
    });
}

app.get('/api/videos/search', async function (req, res) {
    try {
        const videos = searchVideos(req.query.q, req.query.category, req.query.access, req.query.cost);
        return res.json({ videos: videos });
    } catch (error) {
        console.error('Failed to search videos:', error);
        return res.status(500).json({ error: 'Failed to search videos' });
    }
});

app.get('/api/wallpapers', function (_req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const wallpaperDir = path.join(__dirname, 'Images', 'Wallpaper');
    fs.readdir(wallpaperDir, function (err, files) {
        if (err) {
            console.error('Failed to read wallpaper directory:', err);
            return res.status(500).json({ error: 'Failed to read wallpaper directory' });
        }
        const images = files
            .filter(function (file) { return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file); })
            .sort(function (a, b) { return a.localeCompare(b); })
            .map(function (file) { return 'Images/Wallpaper/' + encodeURIComponent(file); });
        return res.json({ wallpapers: images });
    });
});

// Serve static HTML/assets from the project root
app.use(express.static(__dirname));
app.get('/', function (_req, res) {
  res.sendFile(path.join(__dirname, 'Index.html'));
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
