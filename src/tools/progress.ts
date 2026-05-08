/**
 * @fileoverview tools progress module.
 */
import type {
	PiToolShell,
	ProgressChecklistItem,
	ProgressCounts,
	ProgressDetails,
	ProgressState,
	TimingInfo,
} from "../types.js";
import type { ToolUpdate } from "./define.js";

export interface ProgressOptions<TData = unknown> {
	state: ProgressState;
	message?: string;
	url?: string;
	current?: number;
	total?: number;
	timing?: Partial<TimingInfo>;
	data?: TData;
	checklist?: ProgressChecklistItem[];
	counts?: ProgressCounts;
}

export function progressShell<TData = unknown>(
	options: ProgressOptions<TData>,
): PiToolShell<ProgressDetails<TData>> {
	return {
		content: [{ type: "text", text: progressText(options) }],
		details: {
			_progress: true,
			state: options.state,
			message: options.message,
			url: options.url,
			current: options.current,
			total: options.total,
			timing: options.timing,
			data: options.data,
			checklist: options.checklist,
			counts: options.counts,
		},
	};
}

export async function emitProgress<TData = unknown>(
	onUpdate: ToolUpdate | undefined,
	options: ProgressOptions<TData>,
): Promise<void> {
	await onUpdate?.(progressShell(options));
}

function progressText(options: ProgressOptions): string {
	const count = options.total
		? ` ${options.current ?? 0}/${options.total}`
		: "";
	const url = options.url ? ` · ${options.url}` : "";
	return `${options.state}${count}${url}${options.message ? ` · ${options.message}` : ""}`;
}
