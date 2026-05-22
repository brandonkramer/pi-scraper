/** @file Pi terminal UI checklist formatting primitives. */
const CHECKLIST_ICONS: Record<string, string> = {
	done: "✓",
	failed: "✕",
	warning: "⚠",
	pending: "☐",
};

export function formatChecklistItem(item: {
	label: string;
	state: string;
	detail?: string;
}): string {
	return `${CHECKLIST_ICONS[item.state] ?? "•"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

export function formatChecklistText(item: { label: string; detail?: string }): string {
	return `${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}
