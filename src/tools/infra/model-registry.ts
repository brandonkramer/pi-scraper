/**
 * @file Cross-extension model-adapter registry over pi.events. Implements the `pi:model-adapter/*`
 *   protocol so any Pi extension can register an LLM transport without either side importing the
 *   other.
 */
import type { ModelAdapter } from "../../extract/adhoc/model.ts";
import { isUnknownRecord } from "../../types.ts";

export type ModelCapability = "summarize" | "extract" | "analyze" | "chat";

export interface RegisteredAdapter {
	id: string;
	label: string;
	capabilities: readonly ModelCapability[];
	priority: number;
	adapter: ModelAdapter;
}

export type ResolvePreference = "auto" | "off" | string;

/**
 * Optional filter for `pi:model-adapter/discover`.
 *
 * @remarks
 *   Adapters SHOULD only re-register when they match the filter; MAY re-register unconditionally
 *   for backwards compatibility.
 */
export interface DiscoverPayload {
	capabilities?: readonly ModelCapability[];
	minPriority?: number;
}

/** In-memory registry of adapters announced over pi.events. */
export class ModelRegistry {
	private entries = new Map<string, RegisteredAdapter>();
	private order: string[] = [];

	register(entry: RegisteredAdapter): void {
		this.entries.set(entry.id, entry);
		if (!this.order.includes(entry.id)) this.order.push(entry.id);
	}

	unregister(id: string): void {
		this.entries.delete(id);
		this.order = this.order.filter((x) => x !== id);
	}

	get(id: string): RegisteredAdapter | undefined {
		return this.entries.get(id);
	}

	resolve(preference: ResolvePreference, capability: ModelCapability): ModelAdapter | undefined {
		if (preference === "off") return;
		if (preference === "auto") {
			const candidates = this.order
				.map((id) => this.entries.get(id))
				.filter((e): e is RegisteredAdapter => e?.capabilities.includes(capability) ?? false);
			if (candidates.length === 0) return;
			let best = candidates[0];
			for (const c of candidates) {
				if (c.priority > best.priority) best = c;
			}
			return best.adapter;
		}
		const entry = this.entries.get(preference);
		if (!entry || !entry.capabilities.includes(capability)) return;
		return entry.adapter;
	}

	list(): RegisteredAdapter[] {
		return this.order.map((id) => this.entries.get(id)).filter(Boolean) as RegisteredAdapter[];
	}

	/** Test helper. */
	clear(): void {
		this.entries.clear();
		this.order.length = 0;
	}
}

/** Module-level singleton consumed by model-backed tools. */
export const modelRegistry = new ModelRegistry();

/** Stored events reference for lazy discover calls without an explicit pi. */
let adapterProtocolEvents:
	| {
			on(event: string, handler: (payload: unknown) => void): void;
			emit(event: string, payload?: unknown): void;
	  }
	| undefined;

/** Wire the singleton to a Pi registrar's event bus. */
export function initModelAdapterProtocol(pi: {
	events?: {
		on(event: string, handler: (payload: unknown) => void): void;
		emit(event: string, payload?: unknown): void;
	};
}): void {
	if (typeof pi.events?.on !== "function") return;
	adapterProtocolEvents = pi.events;
	pi.events.on("pi:model-adapter/register", (payload) => {
		const entry = validateAdapterPayload(payload);
		if (entry) modelRegistry.register(entry);
	});
	pi.events.on("pi:model-adapter/unregister", (payload) => {
		if (isUnknownRecord(payload) && typeof payload.id === "string") {
			modelRegistry.unregister(payload.id);
		}
	});
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
	pi.events.emit?.("pi:model-adapter/discover", {});
}

/**
 * Emit a `pi:model-adapter/discover` event, optionally scoped by capability or minimum priority. A
 * no-op when `pi.events.emit` is unavailable.
 *
 * @remarks
 *   Callers that lack an explicit `pi` reference (e.g. inside tool `execute`) can pass `undefined`
 *   for `pi`; the helper falls back to the events reference captured during
 *   `initModelAdapterProtocol`.
 */
export function requestAdapterDiscovery(
	pi?: {
		events?: { emit(event: string, payload?: unknown): void };
	},
	filter?: DiscoverPayload,
): void {
	const events = pi?.events ?? adapterProtocolEvents;
	if (typeof events?.emit !== "function") return;
	events.emit("pi:model-adapter/discover", filter ?? {});
}

/** Duck-type an incoming payload; return null if malformed. */
export function validateAdapterPayload(payload: unknown): RegisteredAdapter | null {
	if (!isUnknownRecord(payload)) return null;
	if (typeof payload.id !== "string" || payload.id.length === 0) return null;
	if (typeof payload.label !== "string") return null;
	if (!Array.isArray(payload.capabilities)) return null;
	if (typeof payload.priority !== "number") return null;
	if (!isUnknownRecord(payload.adapter) || typeof payload.adapter.run !== "function") {
		return null;
	}
	const capabilities = payload.capabilities.filter(
		(c): c is ModelCapability =>
			typeof c === "string" && ["summarize", "extract", "analyze", "chat"].includes(c),
	);
	return {
		id: payload.id,
		label: payload.label,
		capabilities,
		priority: payload.priority,
		adapter: payload.adapter as unknown as ModelAdapter,
	};
}
