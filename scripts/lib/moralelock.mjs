// 0.8.20 #3: idempotency keys for a morale run.
//   trigger key: an explicit trigger (e.g. the moralePrompt eventId) -> morale:<trigger>
//   set key: during combat, combat id + the sorted living target tokens -> morale:<combat>:<ids>
// A run records both keys. A repeat with the same trigger, or with no trigger and the same targets in the same
// fight, returns the first result instead of posting more cards. A new death changes the target set, so the next
// real trigger rolls again. Outside combat with no trigger there is no key (every call rolls).
export function moraleSetKey(combat, targets = []) {
  if (!combat?.id) return null;
  const ids = targets.map(t => t.tokenId || t.actor?.id || t.name).filter(Boolean).map(String).sort().join(",");
  return `morale:${combat.id}:${ids}`;
}
export function moraleKeys({ trigger, combat, targets = [] } = {}) {
  const keys = [];
  if (trigger != null && String(trigger).trim()) keys.push(`morale:${String(trigger).trim()}`);
  const set = moraleSetKey(combat, targets); if (set) keys.push(set);
  return keys;
}
// The key that decides "already done": the trigger key when given, else the set key.
export function moraleKey(o = {}) { return moraleKeys(o)[0] ?? null; }
