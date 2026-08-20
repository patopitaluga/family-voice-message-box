import dns from 'node:dns';

const systemLookup: typeof dns.lookup = dns.lookup.bind(dns);

/**
 * Imported in `send-audio-tg.ts` (runs before any Telegram `fetch`).
 * Raspberry Pi often has no IPv6 route; Node Happy Eyeballs still tries AAAA
 * and `fetch` times out even when `curl` to api.telegram.org works over IPv4.
 */
export function preferIpv4(): void {
  dns.setDefaultResultOrder('ipv4first');

  const lookupIpv4: typeof dns.lookup = ((
    hostname: string,
    options:
      | dns.LookupOneOptions
      | dns.LookupAllOptions
      | dns.LookupOptions
      | ((
        err: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number,
      ) => void),
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    if (typeof options === 'function')
      return systemLookup(hostname, { family: 4 }, options);

    return systemLookup(
      hostname,
      { ...options, family: 4 },
      callback as Parameters<typeof systemLookup>[2],
    );
  }) as typeof dns.lookup;

  dns.lookup = lookupIpv4;
}
