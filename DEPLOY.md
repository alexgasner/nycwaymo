# Deploying to Replit with a Custom Domain

## 1. Push to GitHub

```bash
git init
git add -A
git commit -m "Initial NYC Waymo dashboard"
git remote add origin https://github.com/<your-username>/nycwaymo.git
git push -u origin main
```

## 2. Import into Replit

1. Go to [replit.com](https://replit.com) and click **Create Repl**
2. Choose **Import from GitHub** and paste your repo URL
3. Replit should auto-detect Node.js

## 3. Configure the build

In Replit's **Shell**, run:
```bash
npm install
npm run build
```

Set the **Run** command (in `.replit` or the Run config) to:
```bash
npm run build && npx serve dist -l 3000
```

Or for Replit Deployments (Static), just point the output directory to `dist/`.

## 4. Update `astro.config.mjs` before deploying

Change the `site` and `base` to match your custom domain:

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://yourdomain.com',  // your custom domain
  base: '/',                        // remove the /nycwaymo subpath
  output: 'static',
});
```

## 5. Connect a custom domain

1. In Replit, go to your project's **Deployments** tab
2. Click **Custom Domain**
3. Enter your domain (e.g., `nycwaymo.com`)
4. Replit will give you DNS records to add at your registrar:
   - **A record** or **CNAME** pointing to Replit's servers
5. Add these records in your domain registrar's DNS settings
6. Wait for DNS propagation (usually 5-30 minutes)
7. Replit handles HTTPS/SSL automatically

## 6. Update the footer link

In `src/pages/index.astro`, update the GitHub link if your repo URL differs:

```html
<a href="https://github.com/<your-username>/nycwaymo" ...>
```

## 7. Weekly data updates

The GitHub Action (`.github/workflows/update-data.yml`) runs every Monday at 9am ET and auto-commits updated fatality/injury data. If you want Replit to stay in sync:

**Option A: Auto-pull from GitHub**
- Set up a Replit scheduled task that runs `git pull && npm run build` weekly

**Option B: Run the update script on Replit directly**
- Create a Replit scheduled task: `node scripts/update-fatalities.mjs && npm run build`
- This queries the NYC Open Data API and updates `src/data/fatalities.json`

## Domain registrar suggestions

- [Namecheap](https://www.namecheap.com) — good prices, easy DNS management
- [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) — at-cost pricing, built-in CDN
- [Google Domains → Squarespace](https://domains.squarespace.com) — simple UI
