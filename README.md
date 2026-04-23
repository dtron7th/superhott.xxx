# superhott.xxx

Neon-backed account hash API + realtime user counter.

## Files

- `Index.html` - frontend scanner + terminal/account flow
- `server.js` - API server (Express + Neon/Drizzle)
- `netlify/functions/api.js` - Netlify function entrypoint for API
- `netlify.toml` - Netlify redirects/functions config
- `package.json` - server dependencies and start script
- `.env.example` - required environment variables

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file from `.env.example`:
   ```bash
   copy .env.example .env
   ```
3. Set your Neon `DATABASE_URL` in `.env`.
   - For Netlify deploys, set `NETLIFY_DATABASE_URL` in Netlify environment variables.
4. Start the API server:
   ```bash
   npm start
   ```

Server runs at `http://localhost:3000` by default.

## Netlify Deploy

- This repo is configured like Altoona-Mcdonalds:
  - `netlify.toml` routes `/api/*` to `/.netlify/functions/api/:splat`
  - `netlify/functions/api.js` wraps the Express app with `serverless-http`
- Set this env var in Netlify:
  - `NETLIFY_DATABASE_URL=<your neon postgres connection string>`

## API Endpoints

- `GET /api/health`
- `GET /api/count`
- `GET /api/account-hashes/:hash`
- `POST /api/account-hashes`
- `GET /api/stream` (SSE realtime counter)

## Frontend API Base

The frontend defaults to:

- `/api`

To point to another host, set before scripts run:

```html
<script>
  window.ACCOUNT_API_BASE = "https://your-api-host";
</script>
```
