// Upload policy (pure). GM-only uploads of base64 content into a module-owned folder; size/type limits; content-hash names
// so re-uploading the same bytes is a no-op (low usage).
import { hashStr } from "./outbox.mjs";
export const UPLOAD_ROOT = "ai-gm-uploads";
export const TYPES = {
  png: { mime: "image/png", kind: "images" }, jpg: { mime: "image/jpeg", kind: "images" }, jpeg: { mime: "image/jpeg", kind: "images" },
  webp: { mime: "image/webp", kind: "images" }, gif: { mime: "image/gif", kind: "images" },
  mp3: { mime: "audio/mpeg", kind: "audio" }, ogg: { mime: "audio/ogg", kind: "audio" }, wav: { mime: "audio/wav", kind: "audio" }, webm: { mime: "audio/webm", kind: "audio" },
  txt: { mime: "text/plain", kind: "text" }, md: { mime: "text/markdown", kind: "text" }, json: { mime: "application/json", kind: "text" },
};
// Magic bytes for binary types: the declared extension must match the content.
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46],
  ogg: [0x4f, 0x67, 0x67, 0x53], wav: [0x52, 0x49, 0x46, 0x46], webm: [0x1a, 0x45, 0xdf, 0xa3] };
export const DEFAULT_LIMITS = { maxBytes: 8 * 1024 * 1024, allowed: Object.keys(TYPES) };

export function safeName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop().normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").replace(/-+/g, "-").slice(0, 80);
  return base || "file";
}
export function b64ToBytes(b64) {
  const s = String(b64).replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) return null;
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}
// -> {error,code} | {ext, mime, kind, dir, fileName, path, bytes, hash}
export function planUpload({ name, data, kind }, limits = DEFAULT_LIMITS) {
  const n = safeName(name); const ext = (n.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const t = TYPES[ext]; const allowed = (limits.allowed ?? DEFAULT_LIMITS.allowed).map(s => s.toLowerCase());
  if (!t || !allowed.includes(ext)) return { code: 415, error: `type not allowed: .${ext || "?"} (allowed: ${allowed.join(", ")})` };
  if (kind && kind !== t.kind) return { code: 400, error: `.${ext} is ${t.kind}, not ${kind}` };
  const approx = Math.floor(String(data ?? "").length * 3 / 4); const max = limits.maxBytes ?? DEFAULT_LIMITS.maxBytes;
  if (approx > max + 3) return { code: 413, error: `too large: ${approx} > ${max} bytes` };
  const bytes = b64ToBytes(data ?? ""); if (!bytes || !bytes.length) return { code: 400, error: "data must be non-empty base64" };
  if (bytes.length > max) return { code: 413, error: `too large: ${bytes.length} > ${max} bytes` };
  const m = MAGIC[ext]; if (m && !m.every((b, i) => bytes[i] === b)) return { code: 415, error: `content is not a valid .${ext}` };
  if (ext === "mp3" && !((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return { code: 415, error: "content is not a valid .mp3" };
  const hash = hashStr(String(data).replace(/^data:[^,]*,/, "").replace(/\s+/g, "")); // full-content hash
  const dir = `${UPLOAD_ROOT}/${t.kind}`; const fileName = `${hash}-${n}`;
  return { ext, mime: t.mime, kind: t.kind, dir, fileName, path: `${dir}/${fileName}`, bytes, hash };
}
