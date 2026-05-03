import type { PiCommandRegistrar } from "./commands/define.js";
import { registerWebCommands } from "./commands/register.js";
import { registerSessionStartHealthChecks, type PiHealthRegistrar } from "./health/session-start.js";
import type { PiToolRegistrar } from "./tools/define.js";
import { registerWebTools } from "./tools/register.js";

type PiScraperRegistrar = PiToolRegistrar & PiCommandRegistrar & PiHealthRegistrar;

export default function registerPiScraperExtension(pi: PiScraperRegistrar): void {
  registerWebTools(pi);
  registerWebCommands(pi);
  registerSessionStartHealthChecks(pi);
}
