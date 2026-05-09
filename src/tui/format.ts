/**
 * @fileoverview Pi terminal UI string formatting primitives for bytes and duration.
 */
export function formatBytes(bytes: number | undefined): string | undefined {
	if (typeof bytes !== "number") return undefined;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatDuration(ms: number | undefined): string | undefined {
	if (typeof ms !== "number") return undefined;
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
