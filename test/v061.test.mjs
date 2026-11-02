import test from "node:test"; import assert from "node:assert/strict";
import { parseAmount, nextValue } from "../scripts/lib/pirateborg.mjs";
import { rollsOf, abilityOf, matchRoll, d20Of, cardHtml } from "../scripts/lib/rollreq.mjs";
test("setHP amount: delta number", () => assert.deepEqual(parseAmount({ delta: -3 }), { delta: -3 }));
test("setHP amount: delta string", () => assert.deepEqual(parseAmount({ delta: "+2" }), { delta: 2 }));
test("setHP amount: +/- string in value is a delta", () => { assert.deepEqual(parseAmount({ value: "-2" }), { delta: -2 }); assert.deepEqual(parseAmount({ value: "5" }), { value: 5 }); });
test("setHP amount: needs exactly one", () => { assert.ok(parseAmount({}).error); assert.ok(parseAmount({ value: 1, delta: 1 }).error); assert.ok(parseAmount({ value: "abc" }).error); });
test("setHP delta clamps", () => { assert.equal(nextValue({ value: 3, max: 8 }, { delta: -5 }), -2); assert.equal(nextValue({ value: 7, max: 8 }, { delta: 4 }), 8); });
const sheet = (actor, ab, total, user = "u1", ts = 100) => ({ id: "m", author: user, timestamp: ts, speaker: { actor }, rolls: [], content: "<h3>Test Agility</h3>",
  flags: { pirateborg: { outcomes: [{ formula: `1d20+@abilities.${ab}.value`, roll: { formula: "1d20 + 2", total, terms: [{ faces: 20, results: [{ result: total - 2, active: true }] }] } }] } } });
const P = [
  { id: "a", userId: "u1", actorId: "A1", stat: "agility", dr: 12, at: 10, status: "pending" },
  { id: "b", userId: "u1", actorId: "A2", stat: "agility", dr: 12, at: 20, status: "pending" },
  { id: "c", userId: "u1", actorId: "A2", stat: "strength", dr: 12, at: 5, status: "pending" },
  { id: "d", userId: "u2", actorId: "A3", stat: "presence", dr: 12, at: 1, status: "pending" }];
test("sheet roll format is read from flags.pirateborg.outcomes", () => { const m = sheet("A1", "agility", 14); assert.equal(rollsOf(m).length, 1); assert.equal(abilityOf(m), "agility"); assert.equal(d20Of(m).total, 14); });
test("ability from flavor for core rolls", () => assert.equal(abilityOf({ flavor: "Spirit check", rolls: [{ formula: "1d20" }] }), "spirit"));
test("match by actor first", () => assert.equal(matchRoll(sheet("A2", "agility", 10), P).id, "b"));
test("then by ability", () => assert.equal(matchRoll(sheet("A2", "strength", 10), P).id, "c"));
test("ability with no matching card -> none", () => assert.equal(matchRoll(sheet("A1", "spirit", 10), P), null));
test("other user's card is not answered", () => assert.equal(matchRoll(sheet("A3", "presence", 10, "u1"), P), null));
test("GM may answer for the card's actor", () => assert.equal(matchRoll(sheet("A3", "presence", 10, { id: "gm", isGM: true }), P).id, "d"));
test("no actor/ability: oldest of user's cards", () => assert.equal(matchRoll({ author: "u1", timestamp: 100, rolls: [{ formula: "1d20", total: 9 }] }, P).id, "c"));
test("expired and past-expireAt cards are skipped", () => {
  const Q = [{ ...P[0], status: "expired" }, { ...P[1], actorId: "A1", expireAt: 50 }];
  assert.equal(matchRoll(sheet("A1", "agility", 10), Q, 60), null);
  assert.equal(matchRoll(sheet("A1", "agility", 10), [{ ...P[1], actorId: "A1", expireAt: 50, status: "timeout" }], 40).id, "b"); });
test("roll before the card doesn't answer it", () => assert.equal(matchRoll(sheet("A1", "agility", 10, "u1", 5), P), null));
test("flagged button roll wins", () => assert.equal(matchRoll({ author: "u1", rolls: [{ formula: "1d20" }], flags: { "ai-gm-bridge": { rollRequestId: "c" } } }, P).id, "c"));
test("card shows expired and who answered", () => {
  assert.match(cardHtml({ actorName: "X", stat: "agility", dr: 12, status: "expired" }), /Expired/);
  assert.match(cardHtml({ actorName: "X", stat: "agility", dr: 12, status: "done", answeredBy: "sheet roll by P", result: { total: 14, success: true } }), /sheet roll by P/); });
