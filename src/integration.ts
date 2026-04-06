/**
 * Astro Integration — Static site generation for EmDash
 *
 * Everything is automatic:
 * 1. astro:build:start — syncs production D1 to local SQLite (reads wrangler.jsonc)
 * 2. astro:route:setup — sets prerender=true on public pages
 * 3. astro:config:setup — Vite plugin injects getStaticPaths() into [slug] pages
 *
 * Auth: reads CF_D1_TOKEN env var. Falls back to wrangler CLI if not set.
 */

import type { AstroIntegration } from "astro";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sanitizeName } from "./validation.js";

interface DeployHookOptions {
	/** Routes to keep as SSR. Defaults to ["/search"]. Admin routes always excluded. */
	dynamic?: string[];
}

// Tables needed for rendering public pages
const RENDER_TABLES = new Set([
	"_emdash_collections", "_emdash_fields", "_emdash_taxonomy_defs",
	"_emdash_menus", "_emdash_menu_items",
	"_emdash_widgets", "_emdash_widget_areas",
	"_emdash_bylines", "_emdash_content_bylines",
	"_emdash_sections", "_emdash_comments", "_emdash_seo",
	"_emdash_settings", "_emdash_migrations", "_emdash_migrations_lock",
	"taxonomies", "content_taxonomies", "media", "revisions", "users",
]);

function isRenderTable(name: string) {
	return name.startsWith("ec_") || RENDER_TABLES.has(name);
}

export function deployHook(options: DeployHookOptions = {}): AstroIntegration {
	const dynamicRoutes = new Set(options.dynamic ?? ["/search"]);

	return {
		name: "emdash-deploy-hook",
		hooks: {
			"astro:build:start": async ({ logger }) => {
				await syncD1(logger);
			},

			"astro:route:setup": ({ route }) => {
				if (!route.component.startsWith("src/pages/")) return;
				for (const pattern of dynamicRoutes) {
					if (route.component.includes(pattern.replace(/^\//, ""))) return;
				}
				route.prerender = true;
			},

			"astro:config:setup": ({ updateConfig }) => {
				updateConfig({ vite: { plugins: [staticPathsVitePlugin()] } });
			},
		},
	};
}

// ── D1 Sync ──

async function syncD1(logger: any) {
	// Read wrangler.jsonc
	let accountId: string, dbId: string, dbName: string;
	try {
		const raw = readFileSync("wrangler.jsonc", "utf8");
		const clean = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,\s*([}\]])/g, "$1");
		const cfg = JSON.parse(clean);
		accountId = cfg.account_id;
		const db = cfg.d1_databases?.[0];
		if (!accountId || !db) throw new Error("missing");
		dbId = db.database_id;
		dbName = db.database_name;
	} catch {
		logger.warn("No D1 config in wrangler.jsonc — skipping sync");
		return;
	}

	const token = process.env.CF_D1_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
	const useApi = !!token;
	logger.info(useApi ? "Syncing D1 via API" : "Syncing D1 via wrangler CLI (set CF_D1_TOKEN for faster builds)");
	const t0 = Date.now();

	// Query helpers
	async function apiQuery(sql: string) {
		const res = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
			{ method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql }) },
		);
		const json = await res.json() as any;
		if (!json.success) throw new Error(json.errors?.[0]?.message || "D1 API error");
		return json.result?.[0]?.results || [];
	}

	function cliQuery(sql: string) {
		try {
			const out = execSync(
				`npx wrangler d1 execute "${dbName}" --remote --json --command "${sql.replace(/"/g, '\\"')}"`,
				{ maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
			);
			return JSON.parse(out.toString())[0]?.results || [];
		} catch { return []; }
	}

	const query: (sql: string) => Promise<any[]> = useApi
		? apiQuery
		: async (sql) => cliQuery(sql);

	// 1. Get schemas
	const allTables = await query(
		"SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE '%fts%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
	);
	const tables = allTables.filter((t: any) => t.sql && isRenderTable(t.name));
	logger.info(`${tables.length} tables (${allTables.length - tables.length} skipped)`);

	// 2. Create schemas locally
	const schema = tables.map((t: any) => t.sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS") + ";").join("\n");
	writeFileSync("/tmp/d1_schema.sql", schema);
	try { execSync(`npx wrangler d1 execute "${dbName}" --local --file=/tmp/d1_schema.sql`, { stdio: "pipe" }); } catch {}

	// 3. Fetch data — parallel with API, sequential with CLI
	const results: Array<{ name: string; rows: any[] }> = useApi
		? await Promise.all(tables.map(async (t: any) => ({ name: t.name, rows: await apiQuery(`SELECT * FROM "${t.name}"`) })))
		: await Promise.all(tables.map(async (t: any) => ({ name: t.name, rows: await query(`SELECT * FROM "${t.name}"`) })));

	// 4. One big INSERT
	let allSQL = "";
	let total = 0;
	for (const { name, rows } of results) {
		if (!rows.length) continue;
		const cols = Object.keys(rows[0]);
		const colList = cols.map((c) => `"${c}"`).join(",");
		for (const r of rows) {
			const vals = cols.map((c) => {
				const v = r[c];
				if (v == null) return "NULL";
				if (typeof v === "number") return String(v);
				return "'" + String(v).replace(/'/g, "''") + "'";
			}).join(",");
			allSQL += `INSERT OR REPLACE INTO "${name}" (${colList}) VALUES (${vals});\n`;
		}
		total += rows.length;
		logger.info(`  ${name}: ${rows.length} rows`);
	}

	if (allSQL) {
		writeFileSync("/tmp/d1_all.sql", allSQL);
		execSync(`npx wrangler d1 execute "${dbName}" --local --file=/tmp/d1_all.sql`, { stdio: "pipe" });
	}

	logger.info(`Synced ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ── Vite Plugin ──

function staticPathsVitePlugin() {
	return {
		name: "emdash-deploy-hook:static-paths",
		transform(code: string, id: string) {
			if (!id.endsWith(".astro") || !id.includes("[")) return null;
			if (code.includes("getStaticPaths") || id.includes("_emdash")) return null;

			const collectionMatch = code.match(/(?:getEmDashEntry|getEmDashCollection)\s*\(\s*["']([a-zA-Z0-9_-]+)["']/);
			const taxonomyMatch = code.match(/(?:getTerm|getTerms)\s*\(\s*["']([a-zA-Z0-9_-]+)["']/);
			if (!collectionMatch && !taxonomyMatch) return null;

			const injection = taxonomyMatch
				? `\nimport { getTaxonomyTerms as __getTaxonomyTerms } from "emdash";\nexport async function getStaticPaths() {\n\tconst terms = await __getTaxonomyTerms(${JSON.stringify(sanitizeName(taxonomyMatch[1]))});\n\treturn terms.map((t) => ({ params: { slug: t.slug } }));\n}\n`
				: `\nimport { getEmDashCollection as __getCollection } from "emdash";\nexport async function getStaticPaths() {\n\tconst { entries } = await __getCollection(${JSON.stringify(sanitizeName(collectionMatch![1]))});\n\treturn entries.map((e) => ({ params: { slug: e.id } }));\n}\n`;

			return { code: injection + code, map: null };
		},
	};
}
