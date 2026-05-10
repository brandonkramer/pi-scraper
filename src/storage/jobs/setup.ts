/**
 * @fileoverview Scrape job orchestration helper (not pure storage).
 */
import { writeJobManifest, createJobManifest } from "./manifest.ts";
import { JobProgressWriter } from "./progress-writer.ts";
import type { JobError } from "./errors.ts";
import type { ResolveStorageOptions } from "../paths.ts";
import type { ScrapeMode, OutputFormat } from "../../types.ts";
import type { JobType } from "./manifest.ts";

export interface ScrapeJobSetup {
	jobId: string;
	jobManifestPath: string;
	writer: JobProgressWriter;
	errors: JobError[];
	totalBytes: number;
	totalChars: number;
	truncatedPages: number;
}

export async function setupScrapeJob(
	params: {
		jobId: string;
		jobType: JobType;
		params: unknown;
		mode?: ScrapeMode | string;
		format?: OutputFormat | string;
		createdAt?: string;
		initialErrors?: readonly JobError[];
	},
	storage: ResolveStorageOptions = {},
): Promise<ScrapeJobSetup> {
	const jobManifestPath = await writeJobManifest(
		createJobManifest({
			jobId: params.jobId,
			jobType: params.jobType,
			createdAt: params.createdAt,
			params: params.params,
			mode: params.mode,
			format: params.format,
		}),
		storage,
	);
	return {
		jobId: params.jobId,
		jobManifestPath,
		writer: new JobProgressWriter(params.jobId, storage),
		errors: [...(params.initialErrors ?? [])],
		totalBytes: 0,
		totalChars: 0,
		truncatedPages: 0,
	};
}
