const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const HOST = '0.0.0.0';

const DATA_DIR = path.join(__dirname, 'data');
const HASHES_FILE = path.join(DATA_DIR, 'accounts.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

const sseClients = new Set();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeStoredProfileRecord(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    if (value.profile && typeof value.profile === 'object') {
        return {
            profile: value.profile,
            createdAt: value.createdAt || null
        };
    }

    return {
        profile: value,
        createdAt: null
    };
}

function buildSearchableAccounts(query, currentHash) {
    var normalizedQuery = String(query || '').trim().toLowerCase();
    var normalizedCurrentHash = String(currentHash || '').trim().toLowerCase();
    var hashes = loadHashes();
    var profiles = loadProfiles();
    var allHashes = {};

    hashes.forEach(function (hash) {
        if (typeof hash === 'string' && hash.length === 64) {
            allHashes[hash.toLowerCase()] = true;
        }
    });

    Object.keys(profiles).forEach(function (hash) {
        allHashes[String(hash || '').toLowerCase()] = true;
    });

    var results = Object.keys(allHashes).map(function (hash) {
        var record = normalizeStoredProfileRecord(profiles[hash]);
        var profile = record && record.profile ? record.profile : {};
        var userName = String(profile.userName || '').trim();
        var name = userName && userName.toLowerCase() !== 'null' ? userName : 'Unknown User';
        var age = String(profile.age || '').trim();
        var sanitizedAge = age && age.toLowerCase() !== 'null' ? age : '?';
        var joinedAt = record && record.createdAt ? record.createdAt : null;
        var isCurrentUser = normalizedCurrentHash.length === 64 && hash === normalizedCurrentHash;

        return {
            accountHash: hash,
            name: name,
            age: sanitizedAge,
            profilePicture: profile.profileImage || '/Images/Profile Images/Profile-1.png',
            joinedAt: joinedAt,
            isCurrentUser: isCurrentUser
        };
    }).filter(function (item) {
        if (!normalizedQuery) {
            return true;
        }
        return (
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.accountHash.includes(normalizedQuery)
        );
    });

    results.sort(function (a, b) {
        if (a.isCurrentUser && !b.isCurrentUser) { return -1; }
        if (!a.isCurrentUser && b.isCurrentUser) { return 1; }
        return a.name.localeCompare(b.name);
    });

    return results;
}

function loadHashes() {
    try {
        if (fs.existsSync(HASHES_FILE)) {
            return JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Failed to load hashes:', error.message);
    }
    return [];
}

function saveHashes(hashes) {
    try {
        fs.writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2), 'utf8');
    } catch (error) {
        console.error('Failed to save hashes:', error.message);
    }
}

function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Failed to load profiles:', error.message);
    }
    return {};
}

function saveProfiles(profiles) {
    try {
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    } catch (error) {
        console.error('Failed to save profiles:', error.message);
    }
}

function broadcastCount(count) {
    var payload = 'data: ' + JSON.stringify({ count: count }) + '\n\n';
    sseClients.forEach(function (client) {
        client.write(payload);
    });
}

app.use(cors());
app.use(express.json({ limit: '50kb' }));

// Health check
app.get('/api/health', function (_req, res) {
    res.json({ ok: true });
});

// Get user count
app.get('/api/count', function (_req, res) {
    var hashes = loadHashes();
    res.json({ count: hashes.length });
});

// Check if hash exists
app.get('/api/account-hashes/:hash', function (req, res) {
    var hash = String(req.params.hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: 'Invalid SHA-256 hash' });
    }

    var hashes = loadHashes();
    var exists = hashes.indexOf(hash) !== -1;
    return res.json({ exists: exists });
});

// Store a new hash
app.post('/api/account-hashes', function (req, res) {
    var hash = String(req.body && req.body.hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: 'Invalid SHA-256 hash' });
    }

    var hashes = loadHashes();
    if (hashes.indexOf(hash) === -1) {
        hashes.push(hash);
        saveHashes(hashes);
        console.log('[+] Account hash stored:', hash.slice(0, 12) + '...');
    }

    var count = hashes.length;
    broadcastCount(count);
    return res.json({ ok: true, count: count });
});

// Store profile data
app.post('/api/account-profile', function (req, res) {
    var accountHash = String(req.body && req.body.accountHash || '').toLowerCase();
    var profile = req.body && req.body.profile || {};

    if (!accountHash) {
        return res.status(400).json({ error: 'Missing accountHash' });
    }

    var profiles = loadProfiles();
    var existingRecord = normalizeStoredProfileRecord(profiles[accountHash]);
    profiles[accountHash] = {
        profile: profile,
        createdAt: existingRecord && existingRecord.createdAt ? existingRecord.createdAt : new Date().toISOString()
    };
    saveProfiles(profiles);
    console.log('[+] Profile saved for:', accountHash.slice(0, 12) + '...');
    return res.json({ ok: true });
});

// Get profile data
app.get('/api/account-profile/:hash', function (req, res) {
    var hash = String(req.params.hash || '').toLowerCase();
    var profiles = loadProfiles();
    var record = normalizeStoredProfileRecord(profiles[hash]);
    return res.json({
        profile: record ? record.profile : null,
        createdAt: record ? record.createdAt : null
    });
});

// Search accounts in local data store
app.get('/api/search/accounts', function (req, res) {
    var query = String(req.query.q || '');
    var currentHash = String(req.query.currentHash || '');
    var results = buildSearchableAccounts(query, currentHash);
    var currentUser = results.find(function (item) { return item.isCurrentUser; }) || null;

    return res.json({
        results: results,
        currentUser: currentUser
    });
});

// SSE stream for live count updates
app.get('/api/stream', function (req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    sseClients.add(res);

    var hashes = loadHashes();
    res.write('data: ' + JSON.stringify({ count: hashes.length }) + '\n\n');

    req.on('close', function () {
        sseClients.delete(res);
        res.end();
    });
});

app.listen(PORT, HOST, function () {
    var hashes = loadHashes();
    console.log('');
    console.log('===========================================');
    console.log('  Local Account Server (Testing)');
    console.log('===========================================');
    console.log('  URL:      http://192.168.0.242:' + PORT);
    console.log('  Accounts: ' + hashes.length + ' stored');
    console.log('  Data:     ' + DATA_DIR);
    console.log('===========================================');
    console.log('');
});
