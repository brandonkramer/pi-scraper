/**
 * @fileoverview index module.
 */
import type { PiCommandRegistrar } from "./commands/define.ts";
import { registerWebCommands } from "./commands/register.ts";
import { registerSessionStartHealthChecks, type PiHealthRegistrar } from "./health/session-start.ts";
import type { PiToolRegistrar } from "./tools/infra/define.ts";
import { registerWebTools } from "./tools/infra/register.ts";

type PiScraperRegistrar = PiToolRegistrar & PiCommandRegistrar & PiHealthRegistrar;

export default function registerPiScraperExtension(pi: PiScraperRegistrar): void {
  registerWebTools(pi);
  registerWebCommands(pi);
  registerSessionStartHealthChecks(pi);
}
