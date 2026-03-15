import { fileURLToPath } from "node:url";
import type { Loader } from "astro/loaders";
import { z } from "astro/zod";
import { loadEnv } from "vite";

const API_BASE = "https://api.val.town";
const FILE_CONTENT_MAX_ATTEMPTS = 4;
const FILE_CONTENT_BASE_DELAY_MS = 250;
const FILE_CONTENT_MAX_DELAY_MS = 4000;
const DEFAULT_CONCURRENCY = 6;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterDelayMs(response: Response): number | null {
	const retryAfter = response.headers.get("retry-after");
	if (!retryAfter) return null;

	const retryAfterSeconds = Number(retryAfter);
	if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
		return Math.round(retryAfterSeconds * 1000);
	}

	const retryAfterDateMs = Date.parse(retryAfter);
	if (Number.isNaN(retryAfterDateMs)) {
		return null;
	}

	return Math.max(0, retryAfterDateMs - Date.now());
}

function isRetriableFileContentStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

interface ValTownLoaderOptions {
	/** Val Town API token (bearer token). Falls back to VALTOWN_API_TOKEN env var. */
	token?: string;
	/** Filter by username. If not set, returns the authenticated user's vals. */
	username?: string;
	/** Filter by privacy level. */
	privacy?: "public" | "unlisted" | "private";
	/** Max number of vals to fetch (handles pagination automatically). Defaults to all. */
	limit?: number;
	/** Whether to fetch file contents for each val. Defaults to true. */
	includeContent?: boolean;
	/** Max number of concurrent file-content fetches. Defaults to 6. */
	concurrency?: number;
}

interface ValAuthor {
	type: string;
	id: string;
	username: string;
}

interface ValResponse {
	name: string;
	id: string;
	createdAt: string;
	privacy: string;
	author: ValAuthor;
	imageUrl: string | null;
	description: string | null;
	links: {
		self: string;
		html: string;
	};
}

interface PaginatedResponse<T> {
	data: T[];
	links: {
		self: string;
		next?: string;
		prev?: string;
	};
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});

	if (!res.ok) {
		throw new Error(
			`Val Town API error: ${res.status} ${res.statusText} for ${url}`,
		);
	}

	return res.json() as Promise<T>;
}

async function resolveUserId(username: string, token: string): Promise<string> {
	const data = await fetchJson<{ id: string }>(
		`${API_BASE}/v1/alias/${encodeURIComponent(username)}`,
		token,
	);
	return data.id;
}

async function* fetchAllVals(
	token: string,
	options: ValTownLoaderOptions,
): AsyncGenerator<ValResponse> {
	const params = new URLSearchParams();
	params.set("limit", "100");

	if (options.privacy) {
		params.set("privacy", options.privacy);
	}

	if (options.username) {
		const userId = await resolveUserId(options.username, token);
		params.set("user_id", userId);
	}

	let url: string | undefined = `${API_BASE}/v2/vals?${params.toString()}`;
	let count = 0;

	while (url) {
		const page: PaginatedResponse<ValResponse> = await fetchJson<
			PaginatedResponse<ValResponse>
		>(url, token);

		for (const val of page.data) {
			yield val;
			count++;
			if (options.limit && count >= options.limit) return;
		}

		url = page.links.next;
	}
}

async function fetchFileContent(
	valId: string,
	filePath: string,
	token: string,
): Promise<string | null> {
	const params = new URLSearchParams({ path: filePath });
	const url = `${API_BASE}/v2/vals/${valId}/files/content?${params.toString()}`;

	for (let attempt = 1; attempt <= FILE_CONTENT_MAX_ATTEMPTS; attempt++) {
		let res: Response;
		try {
			res = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
			});
		} catch (error) {
			if (attempt >= FILE_CONTENT_MAX_ATTEMPTS) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				throw new Error(
					`Val Town file content request failed after ${FILE_CONTENT_MAX_ATTEMPTS} attempts for ${valId}:${filePath}: ${errorMessage}`,
				);
			}

			const delayMs = Math.min(
				FILE_CONTENT_BASE_DELAY_MS * 2 ** (attempt - 1),
				FILE_CONTENT_MAX_DELAY_MS,
			);
			await sleep(delayMs);
			continue;
		}

		if (res.status === 404) {
			return null;
		}

		if (res.ok) {
			return res.text();
		}

		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`Val Town file content request failed with ${res.status} ${res.statusText} for ${valId}:${filePath}. Ensure VALTOWN_API_TOKEN has access to this val.`,
			);
		}

		if (
			isRetriableFileContentStatus(res.status) &&
			attempt < FILE_CONTENT_MAX_ATTEMPTS
		) {
			const retryAfterDelayMs = getRetryAfterDelayMs(res);
			const defaultDelayMs = Math.min(
				FILE_CONTENT_BASE_DELAY_MS * 2 ** (attempt - 1),
				FILE_CONTENT_MAX_DELAY_MS,
			);

			await sleep(retryAfterDelayMs ?? defaultDelayMs);
			continue;
		}

		throw new Error(
			`Val Town file content error: ${res.status} ${res.statusText} for ${valId}:${filePath}`,
		);
	}

	throw new Error(
		`Val Town file content request exceeded retry budget for ${valId}:${filePath}`,
	);
}

interface FileMetadata {
	name: string;
	id: string;
	path: string;
	type: string;
	links: {
		self: string;
		html: string;
		module?: string;
		endpoint?: string;
	};
}

async function fetchValFiles(
	valId: string,
	token: string,
): Promise<FileMetadata[]> {
	const params = new URLSearchParams({
		path: "",
		recursive: "true",
		limit: "100",
	});

	const files: FileMetadata[] = [];
	let url: string | undefined =
		`${API_BASE}/v2/vals/${valId}/files?${params.toString()}`;

	while (url) {
		const page: PaginatedResponse<FileMetadata> = await fetchJson<
			PaginatedResponse<FileMetadata>
		>(url, token);
		for (const file of page.data) {
			if (file.type !== "directory") {
				files.push(file);
			}
		}
		url = page.links.next;
	}

	return files;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await fn(items[index]);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}

export function valTownLoader(options: ValTownLoaderOptions = {}): Loader {
	return {
		name: "valtown-loader",
		load: async ({ store, logger, parseData, config }) => {
			if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1)) {
				throw new Error(
					`Invalid limit: ${options.limit}. Must be a positive integer.`,
				);
			}

			const envMode = process.env.NODE_ENV ?? "";
			const env = loadEnv(envMode, fileURLToPath(config.root), "");
			const token =
				options.token ?? process.env.VALTOWN_API_TOKEN ?? env.VALTOWN_API_TOKEN;

			if (!token) {
				throw new Error(
					"Val Town API token is required. Pass it via the `token` option or set the VALTOWN_API_TOKEN environment variable.",
				);
			}

			const includeContent = options.includeContent !== false;
			const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

			logger.info("Fetching vals from Val Town…");
			store.clear();

			let count = 0;

			for await (const val of fetchAllVals(token, options)) {
				const files = await fetchValFiles(val.id, token);

				let fileContents: Record<string, string | null> = {};
				if (includeContent) {
					const contents = await mapWithConcurrency(
						files,
						concurrency,
						(file) => fetchFileContent(val.id, file.path, token),
					);
					for (let i = 0; i < files.length; i++) {
						fileContents[files[i].path] = contents[i];
					}
				}

				const data = await parseData({
					id: val.id,
					data: {
						name: val.name,
						createdAt: val.createdAt,
						privacy: val.privacy,
						author: val.author,
						imageUrl: val.imageUrl,
						description: val.description,
						url: val.links.html,
						files: files.map((f) => ({
							name: f.name,
							path: f.path,
							type: f.type,
							url: f.links.html,
							moduleUrl: f.links.module ?? null,
							endpointUrl: f.links.endpoint ?? null,
							content: includeContent ? (fileContents[f.path] ?? null) : null,
						})),
					},
				});

				store.set({ id: val.id, data });
				count++;
			}

			logger.info(`Loaded ${count} vals from Val Town`);
		},
		schema: z.object({
			name: z.string(),
			createdAt: z.coerce.date(),
			privacy: z.enum(["public", "unlisted", "private"]),
			author: z.object({
				type: z.string(),
				id: z.string(),
				username: z.string(),
			}),
			imageUrl: z.string().nullable(),
			description: z.string().nullable(),
			url: z.string().url(),
			files: z.array(
				z.object({
					name: z.string(),
					path: z.string(),
					type: z.string(),
					url: z.string(),
					moduleUrl: z.string().nullable(),
					endpointUrl: z.string().nullable(),
					content: z.string().nullable(),
				}),
			),
		}),
	} satisfies Loader;
}

export default valTownLoader;
