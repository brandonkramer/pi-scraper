/** @file Http guarded-agent module. */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";

import { Agent, type Dispatcher } from "undici";

import { assertPublicAddresses, type UrlSafetyOptions } from "./url-safety.ts";

let sharedAgent: Agent | undefined;

export function createDefaultDispatcher(options: UrlSafetyOptions): Dispatcher {
	// DNS rebinding mitigation for the default Undici path: preflight URL
	// validation still runs before every request/redirect, and this guarded
	// lookup re-checks the exact addresses handed to the connect syscall. Custom
	// dispatchers are treated as advanced caller-supplied infrastructure and are
	// still protected by pre-request and per-redirect safety checks.
	//
	// The shared Agent always uses the guarded lookup. The only way to bypass the
	// dispatcher-level guard is `allowPrivateNetwork: true`, which creates a fresh
	// unguarded Agent per call. `resolveDns: false` no longer affects the
	// dispatcher; DNS resolution is handled upstream in URL-safety preflight.
	if (options.allowPrivateNetwork !== true) {
		sharedAgent ??= new Agent({
			connect: { autoSelectFamily: true, lookup: createGuardedLookup() },
			keepAliveTimeout: 30_000,
		});
		return sharedAgent;
	}
	return new Agent({ connect: { autoSelectFamily: true } });
}

function createGuardedLookup(): GuardedLookup {
	return (hostname, lookupOptions, callback) => {
		dnsLookup(hostname, lookupOptions, (error, address, family) => {
			if (error) {
				callback(error, address as string & LookupAddress[], family);
				return;
			}
			const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
			try {
				assertPublicAddresses(addresses, `dns:${hostname}`);
				callback(null, address as string & LookupAddress[], family);
			} catch (guardError) {
				callback(guardError as NodeJS.ErrnoException, address as string & LookupAddress[], family);
			}
		});
	};
}

type GuardedLookup = (
	hostname: string,
	options: LookupOptions,
	callback: (
		err: NodeJS.ErrnoException | null,
		address: string | LookupAddress[],
		family?: number,
	) => void,
) => void;
