# Coral Authorize

Vite + React + Tailwind v4 build of the PA engine prototype.

## Run locally
```
npm install
npm run dev
```

## Build
```
npm run build      # outputs to dist/
```

## Deploy to Netlify
**Option A — Git (recommended):** push this folder to a GitHub repo, then in Netlify
"Add new site → Import an existing project" → pick the repo. It auto-detects Vite
(build `npm run build`, publish `dist`). Every push redeploys.

**Option B — CLI / drag-and-drop:**
```
npm run build
npx netlify deploy --prod --dir=dist     # or drag the dist/ folder to app.netlify.com/drop
```

Requires Node 20+.
