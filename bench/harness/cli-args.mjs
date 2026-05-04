export function intFlag(argv, name, fallback) {
	const match = argv.find((arg) => arg.startsWith(`--${name}=`));
	if (!match) return fallback;
	const value = Number.parseInt(match.split("=")[1], 10);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function stringFlag(argv, name, fallback) {
	const match = argv.find((arg) => arg.startsWith(`--${name}=`));
	if (!match) return fallback;
	const value = match.slice(name.length + 3).trim();
	return value.length > 0 ? value : fallback;
}
