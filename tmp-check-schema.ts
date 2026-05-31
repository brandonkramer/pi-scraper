// Directly construct JSON schema from TypeBox via JSON schema compilation
import { Type } from "typebox";

import { webTools } from "./src/tools/infra/register.ts";

// Convert TypeBox schema to JSON Schema using TypeBox's built-in JSON Schema generation
for (const tool of webTools) {
	const schema: any = {};
	schema.name = tool.name;
	schema.description = tool.description;

	// Derive JSON Schema from TypeBox properly
	const jsonSchema = Type.Strict(Type.CloneType(tool.parameters as any)) as any;
	schema.parameters = jsonSchema;

	const json = JSON.stringify(schema);
	const tokens = Math.ceil(json.length / 4);

	console.log(`${tool.name}: ${tokens} tokens (${json.length} chars)`);

	// Show the full schema JSON for the biggest
	if (tool.name === "web_extract" || tool.name === "web_scrape") {
		console.log(`  Full: ${json.slice(0, 200)}...`);
	}
}
