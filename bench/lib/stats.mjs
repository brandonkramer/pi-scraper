export async function timedRepeats(fn, { warmup, repeats }) {
	for (let i = 0; i < warmup; i++) await fn();
	const samples = [];
	for (let i = 0; i < repeats; i++) {
		const start = performance.now();
		await fn();
		samples.push(performance.now() - start);
	}
	return summarize(samples);
}

export function summarize(samples) {
	if (samples.length === 0) return;
	const sorted = [...samples].sort((a, b) => a - b);
	const n = sorted.length;
	const sum = sorted.reduce((acc, value) => acc + value, 0);
	const mean = sum / n;
	const variance = sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / n;
	return {
		samples: n,
		min_ms: round(sorted[0]),
		median_ms: round(sorted[Math.floor(n / 2)]),
		mean_ms: round(mean),
		p95_ms: round(sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]),
		max_ms: round(sorted[n - 1]),
		stddev_ms: round(Math.sqrt(variance)),
	};
}

function round(value) {
	return Math.round(value * 100) / 100;
}
