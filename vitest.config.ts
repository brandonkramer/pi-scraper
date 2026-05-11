/** @file Vitest configuration for pi-scraper. */
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["**/node_modules/**", "**/.pi/**"],
	},
});
