import { describe, it, expect, vi, beforeEach } from "vitest";

// mock emdash module before importing
vi.mock("emdash", () => ({
	definePlugin: (config: unknown) => config,
}));

import plugin from "../sandbox-entry.js";

// test helpers

function createMockCtx(kvStore: Record<string, string> = {}) {
	const store = new Map(Object.entries(kvStore));
	return {
		kv: {
			get: vi.fn(async <T>(key: string): Promise<T | null> => (store.get(key) as T) ?? null),
			set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
		},
		http: {
			fetch: vi.fn(),
		},
		log: {
			info: vi.fn(),
			error: vi.fn(),
		},
	};
}

function routeCtx(input: unknown) {
	return { input, request: { url: "https://admin.test/deploy" } };
}

const routes = (plugin as { routes: Record<string, { handler: Function }> }).routes;

describe("admin route handler", () => {
	let ctx: ReturnType<typeof createMockCtx>;

	beforeEach(() => {
		ctx = createMockCtx();
	});

	it("returns blocks on page_load", async () => {
		const result = await routes.admin.handler(
			routeCtx({ type: "page_load" }),
			ctx,
		);
		expect(result.blocks).toBeDefined();
		expect(result.blocks.length).toBeGreaterThan(0);
	});

	it("rejects invalid interaction payloads", async () => {
		const result = await routes.admin.handler(
			routeCtx("not-an-object"),
			ctx,
		);
		expect(result.blocks).toBeDefined();
		expect(ctx.log.error).toHaveBeenCalled();
	});

	it("rejects non-HTTPS hook URLs on save", async () => {
		const result = await routes.admin.handler(
			routeCtx({
				type: "form_submit",
				action_id: "save_settings",
				values: { hookUrl: "http://insecure.example.com/hook" },
			}),
			ctx,
		);
		expect(result.toast.type).toBe("error");
		expect(result.toast.message).toContain("HTTPS");
		expect(ctx.kv.set).not.toHaveBeenCalledWith("settings:hookUrl", expect.anything());
	});

	it("rejects empty hook URL on save", async () => {
		const result = await routes.admin.handler(
			routeCtx({
				type: "form_submit",
				action_id: "save_settings",
				values: { hookUrl: "" },
			}),
			ctx,
		);
		expect(result.toast.type).toBe("error");
	});

	it("saves valid HTTPS hook URL", async () => {
		const url = "https://api.cloudflare.com/hooks/abc";
		const result = await routes.admin.handler(
			routeCtx({
				type: "form_submit",
				action_id: "save_settings",
				values: { hookUrl: url },
			}),
			ctx,
		);
		expect(result.toast.type).toBe("success");
		expect(ctx.kv.set).toHaveBeenCalledWith("settings:hookUrl", url);
	});

	it("triggers build and returns success toast", async () => {
		ctx = createMockCtx({ "settings:hookUrl": "https://api.cloudflare.com/hooks/abc" });
		ctx.http.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

		const result = await routes.admin.handler(
			routeCtx({ type: "block_action", action_id: "trigger_build" }),
			ctx,
		);
		expect(result.toast.type).toBe("success");
		expect(ctx.http.fetch).toHaveBeenCalledWith(
			"https://api.cloudflare.com/hooks/abc",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: expect.any(String),
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("returns error toast on failed build", async () => {
		ctx = createMockCtx({ "settings:hookUrl": "https://api.cloudflare.com/hooks/abc" });
		ctx.http.fetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

		const result = await routes.admin.handler(
			routeCtx({ type: "block_action", action_id: "trigger_build" }),
			ctx,
		);
		expect(result.toast.type).toBe("error");
		expect(result.toast.message).toContain("500");
	});

	it("handles fetch timeout gracefully", async () => {
		ctx = createMockCtx({ "settings:hookUrl": "https://api.cloudflare.com/hooks/abc" });
		const abortError = new DOMException("The operation was aborted", "AbortError");
		ctx.http.fetch.mockRejectedValue(abortError);

		const result = await routes.admin.handler(
			routeCtx({ type: "block_action", action_id: "trigger_build" }),
			ctx,
		);
		expect(result.toast.type).toBe("error");
		expect(result.toast.message).toContain("timed out");
	});
});

describe("status route", () => {
	it("returns configured status", async () => {
		const ctx = createMockCtx({ "settings:hookUrl": "https://example.com/hook" });
		const result = await routes.status.handler({}, ctx);
		expect(result.configured).toBe(true);
	});

	it("returns unconfigured when no URL", async () => {
		const ctx = createMockCtx();
		const result = await routes.status.handler({}, ctx);
		expect(result.configured).toBe(false);
	});
});

describe("build route", () => {
	it("returns error when no URL configured", async () => {
		const ctx = createMockCtx();
		const result = await routes.build.handler({}, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("No deploy hook URL");
	});
});
