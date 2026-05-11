import type { ResolveStorageOptions } from "../paths.ts";
/** @file Batched, throttled job progress writer. */
import { updateJobManifest, type JobManifest, type JobManifestPatch } from "./manifest.ts";
import { mergeUnique } from "./merge.ts";

export interface JobProgressWriterOptions extends ResolveStorageOptions {
	minIntervalMs?: number;
	now?: () => number;
}

const DEFAULT_PROGRESS_MIN_INTERVAL_MS = 500;

export class JobProgressWriter {
	private readonly minIntervalMs: number;
	private readonly now: () => number;
	private readonly storageOptions: ResolveStorageOptions;
	private pending?: JobManifestPatch;
	private chain: Promise<{ manifest: JobManifest; path: string } | undefined> =
		Promise.resolve() as Promise<{ manifest: JobManifest; path: string } | undefined>;
	private lastWriteMs = 0;

	constructor(
		private readonly jobId: string,
		options: JobProgressWriterOptions = {},
	) {
		const { minIntervalMs, now, ...storageOptions } = options;
		this.minIntervalMs = minIntervalMs ?? DEFAULT_PROGRESS_MIN_INTERVAL_MS;
		this.now = now ?? Date.now;
		this.storageOptions = storageOptions;
	}

	shouldFlush(force = false): boolean {
		return force || this.lastWriteMs === 0 || this.now() - this.lastWriteMs >= this.minIntervalMs;
	}

	async update(
		patch: JobManifestPatch,
		options: { force?: boolean } = {},
	): Promise<{ manifest: JobManifest; path: string } | undefined> {
		this.pending = mergePatches(this.pending, patch);
		if (!this.shouldFlush(options.force)) return;
		return await this.flush();
	}

	async flush(): Promise<{ manifest: JobManifest; path: string } | undefined> {
		if (!this.pending) return;
		const patch = this.pending;
		this.pending = undefined;
		this.chain = this.chain
			.catch(() => {
				/* no-op */
			})
			.then(async () => {
				const updated = await updateJobManifest(this.jobId, patch, this.storageOptions);
				this.lastWriteMs = this.now();
				return updated;
			});
		return await this.chain;
	}
}

function mergePatches(
	left: JobManifestPatch | undefined,
	right: JobManifestPatch,
): JobManifestPatch {
	return {
		...left,
		...right,
		errors: right.errors ?? left?.errors,
		params: right.params ?? left?.params,
		responseIds: mergeUnique(left?.responseIds, right.responseIds),
		snapshots: right.snapshots ?? left?.snapshots,
	};
}
