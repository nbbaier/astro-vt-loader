import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	getRetryAfterDelayMs,
	isRetriableFileContentStatus,
	mapWithConcurrency,
	parseEnvFile,
	readEnvFileVar,
	valTownLoader,
} from "./index";

// ---------------------------------------------------------------------------
// getRetryAfterDelayMs
// ---------------------------------------------------------------------------
describe("getRetryAfterDelayMs", () => {
	test("returns null when header is missing", () => {
		const res = new Response(null, { headers: {} });
		expect(getRetryAfterDelayMs(res)).toBeNull();
	});

	test("parses numeric seconds", () => {
		const res = new Response(null, {
			headers: { "retry-after": "2" },
		});
		expect(getRetryAfterDelayMs(res)).toBe(2000);
	});

	test("parses zero seconds", () => {
		const res = new Response(null, {
			headers: { "retry-after": "0" },
		});
		expect(getRetryAfterDelayMs(res)).toBe(0);
	});

	test("parses an HTTP-date in the future", () => {
		const futureDate = new Date(Date.now() + 5000).toUTCString();
		const res = new Response(null, {
			headers: { "retry-after": futureDate },
		});
		const ms = getRetryAfterDelayMs(res)!;
		expect(ms).toBeGreaterThan(3000);
		expect(ms).toBeLessThanOrEqual(5500);
	});

	test("returns 0 for an HTTP-date in the past", () => {
		const pastDate = new Date(Date.now() - 10000).toUTCString();
		const res = new Response(null, {
			headers: { "retry-after": pastDate },
		});
		expect(getRetryAfterDelayMs(res)).toBe(0);
	});

	test("returns null for unparseable value", () => {
		const res = new Response(null, {
			headers: { "retry-after": "not-a-number-or-date" },
		});
		expect(getRetryAfterDelayMs(res)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// isRetriableFileContentStatus
// ---------------------------------------------------------------------------
describe("isRetriableFileContentStatus", () => {
	test("429 is retriable", () => {
		expect(isRetriableFileContentStatus(429)).toBe(true);
	});

	test("500, 502, 503 are retriable", () => {
		for (const code of [500, 502, 503]) {
			expect(isRetriableFileContentStatus(code)).toBe(true);
		}
	});

	test("200, 400, 401, 403, 404 are not retriable", () => {
		for (const code of [200, 400, 401, 403, 404]) {
			expect(isRetriableFileContentStatus(code)).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// mapWithConcurrency
// ---------------------------------------------------------------------------
describe("mapWithConcurrency", () => {
	test("maps all items and preserves order", async () => {
		const result = await mapWithConcurrency(
			[1, 2, 3],
			2,
			async (n) => n * 10,
		);
		expect(result).toEqual([10, 20, 30]);
	});

	test("handles empty input", async () => {
		const result = await mapWithConcurrency([], 4, async (n: number) => n);
		expect(result).toEqual([]);
	});

	test("limits concurrency", async () => {
		let active = 0;
		let maxActive = 0;

		const result = await mapWithConcurrency(
			[1, 2, 3, 4, 5, 6],
			2,
			async (n) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return n;
			},
		);

		expect(result).toEqual([1, 2, 3, 4, 5, 6]);
		expect(maxActive).toBeLessThanOrEqual(2);
	});

	test("propagates errors", async () => {
		await expect(
			mapWithConcurrency([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
	});
});

// ---------------------------------------------------------------------------
// parseEnvFile / readEnvFileVar
// ---------------------------------------------------------------------------
describe("parseEnvFile", () => {
	test("parses key=value pairs, skipping blanks and comments", () => {
		const contents = [
			"# a comment",
			"",
			"FOO=bar",
			'QUOTED="quoted value"',
			"SINGLE='single value'",
			"  SPACED = spaced value  ",
		].join("\n");

		expect(parseEnvFile(contents)).toEqual({
			FOO: "bar",
			QUOTED: "quoted value",
			SINGLE: "single value",
			SPACED: "spaced value",
		});
	});
});

describe("readEnvFileVar", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "vt-loader-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("reads a var from .env", () => {
		writeFileSync(join(dir, ".env"), "VALTOWN_API_TOKEN=dot-env-token\n");
		const root = pathToFileURL(`${dir}/`);
		expect(readEnvFileVar(root, "VALTOWN_API_TOKEN")).toBe("dot-env-token");
	});

	test(".env.local takes precedence over .env", () => {
		writeFileSync(join(dir, ".env"), "VALTOWN_API_TOKEN=base-token\n");
		writeFileSync(
			join(dir, ".env.local"),
			"VALTOWN_API_TOKEN=local-token\n",
		);
		const root = pathToFileURL(`${dir}/`);
		expect(readEnvFileVar(root, "VALTOWN_API_TOKEN")).toBe("local-token");
	});

	test("returns undefined when no env file exists", () => {
		const root = pathToFileURL(`${dir}/`);
		expect(readEnvFileVar(root, "VALTOWN_API_TOKEN")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// valTownLoader – integration (mocked fetch)
// ---------------------------------------------------------------------------
describe("valTownLoader", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
		globalThis.fetch = mock(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url =
					typeof input === "string" ? input : (input as URL).toString();
				return Promise.resolve(handler(url, init));
			},
		) as typeof fetch;
	}

	const fakeVal = {
		name: "my-val",
		id: "val-1",
		createdAt: "2025-01-01T00:00:00.000Z",
		privacy: "public",
		author: { type: "user", id: "u1", username: "alice" },
		imageUrl: null,
		description: "A test val",
		links: { self: "https://api.val.town/v2/vals/val-1", html: "https://www.val.town/x/alice/my-val" },
	};

	const fakeFile = {
		name: "main.ts",
		id: "f1",
		path: "main.ts",
		type: "script",
		links: {
			self: "https://api.val.town/v2/vals/val-1/files/f1",
			html: "https://www.val.town/x/alice/my-val/main.ts",
			module: "https://esm.town/v/alice/my-val/main.ts",
		},
	};

	function setupMockApi(opts?: { includeContent?: boolean }) {
		const includeContent = opts?.includeContent !== false;
		mockFetch((url) => {
			if (url.includes("/v2/vals?") || url.includes("/v2/vals&")) {
				return Response.json({
					data: [fakeVal],
					links: { self: url },
				});
			}
			if (url.includes("/v2/vals/val-1/files/content")) {
				return new Response("console.log('hello');", { status: 200 });
			}
			if (url.includes("/v2/vals/val-1/files")) {
				return Response.json({
					data: [fakeFile],
					links: { self: url },
				});
			}
			return new Response("Not found", { status: 404 });
		});
	}

	function makeLoaderContext() {
		const entries = new Map<string, unknown>();
		return {
			store: {
				clear: mock(() => entries.clear()),
				set: mock((entry: { id: string; data: unknown }) => {
					entries.set(entry.id, entry.data);
				}),
			},
			logger: {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
			},
			parseData: mock(({ data }: { id: string; data: unknown }) =>
				Promise.resolve(data),
			),
			config: {
				root: new URL("file:///fake/project/"),
			},
			entries,
		};
	}

	test("throws when no token is provided", async () => {
		const prev = process.env.VALTOWN_API_TOKEN;
		delete process.env.VALTOWN_API_TOKEN;

		try {
			const loader = valTownLoader();
			const ctx = makeLoaderContext();
			await expect(
				loader.load(ctx as Parameters<typeof loader.load>[0]),
			).rejects.toThrow("token is required");
		} finally {
			if (prev !== undefined) process.env.VALTOWN_API_TOKEN = prev;
		}
	});

	test("reads token from process.env.VALTOWN_API_TOKEN", async () => {
		const prev = process.env.VALTOWN_API_TOKEN;
		process.env.VALTOWN_API_TOKEN = "env-token";

		try {
			setupMockApi();
			const loader = valTownLoader();
			const ctx = makeLoaderContext();

			await loader.load(ctx as Parameters<typeof loader.load>[0]);

			const fetchMock = globalThis.fetch as unknown as {
				mock: { calls: [RequestInfo | URL, RequestInit | undefined][] };
			};
			const [, init] = fetchMock.mock.calls[0];
			expect(
				(init?.headers as Record<string, string>)?.Authorization,
			).toBe("Bearer env-token");
		} finally {
			if (prev !== undefined) {
				process.env.VALTOWN_API_TOKEN = prev;
			} else {
				delete process.env.VALTOWN_API_TOKEN;
			}
		}
	});

	test("reads token from a project .env file", async () => {
		const prev = process.env.VALTOWN_API_TOKEN;
		delete process.env.VALTOWN_API_TOKEN;
		const dir = mkdtempSync(join(tmpdir(), "vt-loader-test-"));
		writeFileSync(join(dir, ".env"), "VALTOWN_API_TOKEN=dot-env-token\n");

		try {
			setupMockApi();
			const loader = valTownLoader();
			const ctx = makeLoaderContext();
			ctx.config.root = pathToFileURL(`${dir}/`);

			await loader.load(ctx as Parameters<typeof loader.load>[0]);

			const fetchMock = globalThis.fetch as unknown as {
				mock: { calls: [RequestInfo | URL, RequestInit | undefined][] };
			};
			const [, init] = fetchMock.mock.calls[0];
			expect(
				(init?.headers as Record<string, string>)?.Authorization,
			).toBe("Bearer dot-env-token");
		} finally {
			if (prev !== undefined) process.env.VALTOWN_API_TOKEN = prev;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("throws on invalid limit", async () => {
		const loader = valTownLoader({ token: "test-token", limit: -1 });
		const ctx = makeLoaderContext();
		await expect(
			loader.load(ctx as Parameters<typeof loader.load>[0]),
		).rejects.toThrow("Invalid limit");
	});

	test("loads vals into the store", async () => {
		setupMockApi();
		const loader = valTownLoader({ token: "test-token" });
		const ctx = makeLoaderContext();

		await loader.load(ctx as Parameters<typeof loader.load>[0]);

		expect(ctx.store.set).toHaveBeenCalledTimes(1);
		expect(ctx.entries.has("val-1")).toBe(true);

		const stored = ctx.entries.get("val-1") as Record<string, unknown>;
		expect(stored.name).toBe("my-val");
		expect((stored.files as Array<{ content: string }>)[0].content).toBe(
			"console.log('hello');",
		);
	});

	test("skips file content when includeContent is false", async () => {
		setupMockApi({ includeContent: false });
		const loader = valTownLoader({
			token: "test-token",
			includeContent: false,
		});
		const ctx = makeLoaderContext();

		await loader.load(ctx as Parameters<typeof loader.load>[0]);

		const stored = ctx.entries.get("val-1") as Record<string, unknown>;
		expect(
			(stored.files as Array<{ content: string | null }>)[0].content,
		).toBeNull();
	});

	test("respects the limit option", async () => {
		mockFetch((url) => {
			if (url.includes("/v2/vals?")) {
				return Response.json({
					data: [
						{ ...fakeVal, id: "val-1", name: "one" },
						{ ...fakeVal, id: "val-2", name: "two" },
						{ ...fakeVal, id: "val-3", name: "three" },
					],
					links: { self: url },
				});
			}
			if (url.includes("/files/content")) {
				return new Response("code", { status: 200 });
			}
			if (url.includes("/files")) {
				return Response.json({ data: [fakeFile], links: { self: url } });
			}
			return new Response("Not found", { status: 404 });
		});

		const loader = valTownLoader({ token: "test-token", limit: 2 });
		const ctx = makeLoaderContext();
		await loader.load(ctx as Parameters<typeof loader.load>[0]);

		expect(ctx.store.set).toHaveBeenCalledTimes(2);
	});
});
