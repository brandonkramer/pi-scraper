/**
 * @fileoverview Pi terminal UI checklist formatting primitives.
 */
export function formatChecklistItem(item: {
	label: string;
	state: string;
	detail?: string;
}): string {
	const icon =
		item.state === "done"
			? "✓"
			: item.state === "failed"
				? "✕"
				: item.state === "warning"
					? "⚠"
					: item.state === "pending"
						? "☐"
						: "•";
	return `${icon} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

export function formatChecklistText(item: {
	label: string;
	detail?: string;
}): string {
	return `${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}
