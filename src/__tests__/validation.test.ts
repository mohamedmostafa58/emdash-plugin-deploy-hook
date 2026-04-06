import { describe, it, expect } from "vitest";
import { validateUrl, sanitizeName } from "../validation.js";

describe("validateUrl", () => {
	it("accepts valid HTTPS URLs", () => {
		expect(validateUrl("https://api.cloudflare.com/hooks/abc123")).toEqual({ valid: true });
		expect(validateUrl("https://example.com/deploy")).toEqual({ valid: true });
	});

	it("rejects empty/missing URLs", () => {
		expect(validateUrl("")).toEqual({ valid: false, error: "URL is required" });
		expect(validateUrl(null as unknown as string)).toEqual({ valid: false, error: "URL is required" });
		expect(validateUrl(undefined as unknown as string)).toEqual({ valid: false, error: "URL is required" });
	});

	it("rejects non-HTTPS protocols", () => {
		const result = validateUrl("http://example.com/hook");
		expect(result.valid).toBe(false);
		expect(result.error).toBe("Only HTTPS URLs are allowed");
	});

	it("rejects javascript: protocol", () => {
		// eslint-disable-next-line no-script-url
		const result = validateUrl("javascript:alert(1)");
		expect(result.valid).toBe(false);
	});

	it("rejects ftp: protocol", () => {
		const result = validateUrl("ftp://files.example.com/hook");
		expect(result.valid).toBe(false);
	});

	it("rejects malformed URLs", () => {
		expect(validateUrl("not-a-url")).toEqual({ valid: false, error: "Invalid URL format" });
		expect(validateUrl("://missing-scheme")).toEqual({ valid: false, error: "Invalid URL format" });
	});

	it("rejects URLs exceeding max length", () => {
		const longUrl = "https://example.com/" + "a".repeat(2100);
		const result = validateUrl(longUrl);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("maximum length");
	});
});

describe("sanitizeName", () => {
	it("passes through valid names", () => {
		expect(sanitizeName("posts")).toBe("posts");
		expect(sanitizeName("blog-posts")).toBe("blog-posts");
		expect(sanitizeName("my_collection")).toBe("my_collection");
		expect(sanitizeName("Collection123")).toBe("Collection123");
	});

	it("strips dangerous characters", () => {
		expect(sanitizeName('"; DROP TABLE--')).toBe("DROPTABLE--");
		expect(sanitizeName("name<script>")).toBe("namescript");
		expect(sanitizeName("col${evil}")).toBe("colevil");
		expect(sanitizeName("a/b/c")).toBe("abc");
	});

	it("handles empty string", () => {
		expect(sanitizeName("")).toBe("");
	});
});
