/**
 * @fileoverview Batched, throttled job progress writer.
 */
import {
	updateJobManifest,
	type JobManifest,
	type JobManifestPatch,
} from "./manifest.ts";
import type { ResolveStorageOptions } from "../paths.ts";

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
		Promise.resolve(undefined);
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
		return (
			force ||
			this.lastWriteMs === 0 ||
			this.now() - this.lastWriteMs >= this.minIntervalMs
		);
	}

	async update(
		patch: JobManifestPatch,
		options: { force?: boolean } = {},
	): Promise<{ manifest: JobManifest; path: string } | undefined> {
		this.pending = mergePatches(this.pending, patch);
		if (!this.shouldFlush(options.force)) return undefined;
		return this.flush();
	}

	async flush(): Promise<{ manifest: JobManifest; path: string } | undefined> {
		if (!this.pending) return undefined;
		const patch = this.pending;
		this.pending = undefined;
		this.chain = this.chain
			.catch(() => undefined)
			.then(async () => {
				const updated = await updateJobManifest(
					this.jobId,
					patch,
					this.storageOptions,
				);
				this.lastWriteMs = this.now();
				return updated;
			});
		return this.chain;
	}
}

function mergePatches(
	left: JobManifestPatch | undefined,
	right: JobManifestPatch,
): JobManifestPatch {
	return {
		...(left ?? {}),
		...right,
		errors: right.errors ?? left?.errors,
		params: right.params ?? left?.params,
		responseIds: mergeUnique(left?.responseIds, right.responseIds),
		snapshots: right.snapshots ?? left?.snapshots,
	};
}

function mergeUnique(
	left: string[] | undefined,
	right: string[] | undefined,
): string[] | undefined {
	const merged = [...(left ?? []), ...(right ?? [])].filter(Boolean);
	return merged.length ? [...new Set(merged)] : undefined;
}
