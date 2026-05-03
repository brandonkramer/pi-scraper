import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { Agent, type Dispatcher } from "undici";
import { assertPublicAddresses, type UrlSafetyOptions } from "./url-safety.js";

export function createDefaultDispatcher(options: UrlSafetyOptions): Dispatcher {
  // DNS rebinding mitigation for the default Undici path: preflight URL
  // validation still runs before every request/redirect, and this guarded
  // lookup re-checks the exact addresses handed to the connect syscall. Custom
  // dispatchers are treated as advanced caller-supplied infrastructure and are
  // still protected by pre-request and per-redirect safety checks.
  const connect = options.resolveDns === false || options.allowPrivateNetwork === true
    ? { autoSelectFamily: true }
    : { autoSelectFamily: true, lookup: createGuardedLookup() };
  return new Agent({ connect });
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
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void;
