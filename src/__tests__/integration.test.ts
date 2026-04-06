import { describe, it, expect } from "vitest";
import { deployHookPlugin } from "../index.js";

describe("deployHookPlugin descriptor", () => {
	it("returns correct plugin descriptor", () => {
		const descriptor = deployHookPlugin();
		expect(descriptor.id).toBe("deploy-hook");
		expect(descriptor.version).toBe("1.0.0");
		expect(descriptor.capabilities).toContain("network:fetch:any");
		expect(descriptor.adminPages).toHaveLength(1);
		expect(descriptor.adminPages[0].path).toBe("/deploy");
	});
});
