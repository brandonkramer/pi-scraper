import type { PiCommandRegistrar, WebCommand } from "./define.js";
import { webSetModeCommand } from "./web-set-mode.js";

export const webCommands: readonly WebCommand[] = [webSetModeCommand];

export function registerWebCommands(pi: PiCommandRegistrar): void {
	for (const command of webCommands) {
		pi.registerCommand(command);
	}
}
