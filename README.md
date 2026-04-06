# emdash-plugin-deploy-hook

Static site generation plugin for [EmDash CMS](https://emdashcms.com).

Converts public pages to pre-built HTML files — zero database queries at runtime. The admin panel keeps working normally. Edit content, click **Build & Deploy**, done.

## Features

- Pre-builds all public pages as static HTML at build time
- No page file modifications needed — fully automatic
- Admin panel with one-click **Build & Deploy** button
- Fast builds with D1 HTTP API (parallel queries) when `CF_D1_TOKEN` is set
- Falls back to wrangler CLI if no token (slower but works)
- Admin routes (`/_emdash/*`) stay server-rendered

## Install

```bash
npm install github:personalwebsitesorg/emdash-plugin-deploy-hook
```

## Setup

### 1. Update `astro.config.mjs`

```typescript
import { deployHook, deployHookPlugin } from "emdash-plugin-deploy-hook";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  vite: {
    resolve: {
      dedupe: ["emdash"],
      preserveSymlinks: true,
    },
  },
  integrations: [
    react(),
    emdash({
      plugins: [formsPlugin(), deployHookPlugin()],
      // ...rest of your config
    }),
    deployHook(),  // must come AFTER emdash()
  ],
});
```

### 2. Connect GitHub to Cloudflare Workers Builds

1. Push your code to GitHub
2. Cloudflare Dashboard → Workers & Pages → your worker → Settings → Builds
3. Connect to Git → select your repo
4. Build command: `npm run build`
5. Deploy command: `npx wrangler deploy`

### 3. Set up a D1 token (recommended)

This makes builds **much faster** (parallel API queries instead of sequential CLI calls).

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token
2. Custom Token → Permissions: **D1 (Read)** → Create
3. Copy the token
4. Add it as a build variable: Workers & Pages → your worker → Settings → Builds → Build variables
5. Name: `CF_D1_TOKEN`, Value: your token, check **Encrypt**

Without the token, the plugin falls back to `wrangler d1 execute --remote` (works but slower).

### 4. Set up the deploy hook

1. In Builds settings → Deploy Hooks → Create Hook
2. Copy the URL
3. Go to your admin panel → Plugins → Deploy
4. Paste the URL → Save

### 5. Click Build & Deploy

That's it. Your site is now static.

## Options

```typescript
deployHook({
  dynamic: ["/search"],  // routes to keep as SSR (default: ["/search"])
})
```

## How It Works

The plugin does three things during `astro build`:

1. **Syncs D1 data** — Reads `wrangler.jsonc` for your database config. Fetches only the tables needed for rendering (content, taxonomies, menus, widgets, media, etc.). Skips auth, sessions, plugin state, and other runtime-only tables. Uses D1 HTTP API with parallel requests when `CF_D1_TOKEN` is set, falls back to wrangler CLI otherwise.

2. **Marks public pages as static** — Uses Astro's `astro:route:setup` hook to set `prerender = true` on all pages in `src/pages/`, except admin routes and routes you list as `dynamic`.

3. **Injects `getStaticPaths()`** — A Vite transform detects EmDash content queries in `[slug].astro` files and auto-injects the matching `getStaticPaths()` function. No page files are modified on disk.

At runtime, the plugin provides an admin page with a "Build & Deploy" button that POSTs to your deploy hook URL, triggering a new build on Cloudflare.

## What Gets Prerendered

| Route | Static | Why |
|-------|--------|-----|
| `/` | Yes | Homepage |
| `/posts/[slug]` | Yes | Each post as HTML |
| `/pages/[slug]` | Yes | Each page as HTML |
| `/tag/[slug]` | Yes | Tag archives |
| `/category/[slug]` | Yes | Category archives |
| `/posts` | Yes | Posts listing |
| `/rss.xml` | Yes | RSS feed |
| `/search` | No | Needs runtime query params |
| `/_emdash/*` | No | Admin panel needs D1 |

## Requirements

- EmDash >= 0.0.3
- Astro >= 5.0.0
- Cloudflare Workers with D1

## License

MIT
