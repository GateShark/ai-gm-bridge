// 0.9.4: Chrome's Local Network Access. A page served from a public address (a hosted Foundry) may not reach a private or
// loopback address unless the user allows it, and the request then fails before it leaves the browser ("Failed to fetch",
// nothing in the webhook log). Detect those URLs so Test connection can say so, and ask Chrome for the permission when it has the API.

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// "loopback" | "local" | "public" | null (not a usable URL). "local" = private LAN, link-local, unique-local IPv6, .local names.
export function addressSpace(url) {
  let host;
  try { host = new URL(String(url).trim()).hostname.toLowerCase(); } catch { return null; }
  if (!host) return null;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // ::ffff:a.b.c.d (the URL parser may also give hex pairs)
  const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const v4 = (mapped ? mapped[1] : hexMapped ? [parseInt(hexMapped[1], 16) >> 8, parseInt(hexMapped[1], 16) & 255, parseInt(hexMapped[2], 16) >> 8, parseInt(hexMapped[2], 16) & 255].join(".") : host).match(V4);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some(n => n > 255)) return "public";
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "local";
    return "public";
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "loopback";
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return "local";
    return "public";
  }
  if (host.endsWith(".local")) return "local";
  return "public";
}
export const isLocalNetworkUrl = (url) => { const s = addressSpace(url); return s === "loopback" || s === "local"; };

// Does this browser know Request#targetAddressSpace (Chrome's Local Network Access)? Checked, never assumed.
export function supportsTargetAddressSpace(globals = globalThis) {
  try { return typeof globals.Request === "function" && "targetAddressSpace" in globals.Request.prototype; } catch { return false; }
}
// Extra fetch options for this URL: declares the address space so Chrome can ask the user for permission (and relax mixed
// content once granted). Empty for public URLs and for browsers without the option.
export function lnaFetchOptions(url, supported = supportsTargetAddressSpace()) {
  const s = addressSpace(url);
  return supported && (s === "loopback" || s === "local") ? { targetAddressSpace: s } : {};
}

export const LOCAL_NETWORK_HINT = "This webhook URL is on your own network (localhost or a private address). Browsers can block a web page from reaching a local-network address, and when that happens the request never leaves the browser, so your webhook sees nothing. Fix it with a public https webhook URL, by allowing this site's local-network access in your browser's site settings (click Test connection again and accept the prompt if one appears), or by switching Delivery to relay.";
