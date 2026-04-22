# superhott.xxx

Neon-backed account hash API + realtime user counter.

## Files

- `Index.html` - frontend scanner + terminal/account flow
- `server.js` - API server (Express + Neon)
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
4. Start the API server:
   ```bash
   npm start
   ```

Server runs at `http://localhost:3000` by default.

## API Endpoints

- `GET /api/health`
- `GET /api/count`
- `GET /api/account-hashes/:hash`
- `POST /api/account-hashes`
- `GET /api/stream` (SSE realtime counter)

## Frontend API Base

The frontend defaults to:

- `http://localhost:3000`

To point to another host, set before scripts run:

```html
<script>
  window.ACCOUNT_API_BASE = "https://your-api-host";
</script>
```
