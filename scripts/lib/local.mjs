import { normAction, splitDr } from "./ship.mjs";
// Local chat commands handled in Foundry with no bot wake. Prefix default "!".
// !roll 2d6 | !r 1d20+2 | !music <playlist>[ stop] | !scene <name> | !hp <actor> <+n|-n|n> | !luck <actor> <+n|-n|n>
// !turn | !rest <actor> [short|long] [starve|donteat] [infected]
// Also !<resource> <actor> <delta> for rituals/prayers/hull/crew. Returns {name,args} for runCommand, or null.
const RES = ["luck", "devilsluck", "rituals", "prayers", "prayer", "hull", "crew", "cargo", "shanties"];
const SHIP_CMDS = ["broadsides", "broadside", "smallarms", "ram", "repair", "fullsail", "comeabout", "shanty", "sink"];
export function parseLocal(text, prefix = "!") {
  const t = String(text ?? "").replace(/<[^>]+>/g, "").trim();
  if (!t.startsWith(prefix)) return null;
  const [cmd, ...rest] = t.slice(prefix.length).trim().split(/\s+/); const c = (cmd || "").toLowerCase(); const arg = rest.join(" ");
  if ((c === "roll" || c === "r") && /^[\dd+\-*/()khl\s]+$/i.test(arg) && arg) return { name: "roll", args: { formula: arg } };
  if (c === "music" && arg) return /\s+stop$/i.test(arg) ? { name: "music", args: { playlist: arg.replace(/\s+stop$/i, ""), action: "stop" } } : { name: "music", args: { playlist: arg, action: "play" } };
  if (c === "turn" && !arg) return { name: "turnStatus", args: {} };
  if ((c === "setup" || c === "setupcheck") && !arg) return { name: "setupCheck", args: {} };
  if (c === "rest" && arg) {
    const w = rest.slice(); const o = { length: "long", food: "eat", infected: false };
    while (w.length > 1 && /^(short|long|starve|donteat|infected)$/i.test(w.at(-1))) { const x = w.pop().toLowerCase();
      if (x === "infected") o.infected = true; else if (x === "short" || x === "long") o.length = x; else o.food = x; }
    return { name: "rest", args: { actorName: w.join(" "), ...o } };
  }
  // v0.8: !morale <actor> [n] | !ship <ship> | !broadsides|!smallarms|!ram|!repair|!fullsail|!comeabout|!shanty|!sink <ship> [dr N]
  if (c === "morale" && arg) { const m = /\s(\d+)$/.exec(arg); return { name: "moraleCheck", args: m ? { actorName: arg.slice(0, m.index), morale: Number(m[1]) } : { actorName: arg } }; }
  if (c === "ship" && arg) return { name: "getShip", args: { actorName: arg } };
  if (SHIP_CMDS.includes(c) && arg) { const { name, dr } = splitDr(rest); if (!name) return null;
    return { name: "shipAction", args: { actorName: name, action: normAction(c), ...(dr ? { dr } : {}) } }; }
  if (c === "scene" && arg) return { name: "scene", args: { sceneName: arg, activate: true } };
  if ((c === "save" || c === "savesession")) return { name: "saveSession", args: arg ? { notes: arg } : {} };
  if ((c === "load" || c === "loadsession" || c === "leftoff") && !arg) return { name: "loadSession", args: {} };
  if ((c === "start" || c === "startgame") && !arg) return { name: "start", args: {} };
  if ((c === "pause" || c === "pausegame") && !arg) return { name: "pause", args: {} };
  const num = rest.at(-1); const who = rest.slice(0, -1).join(" ");
  if (!who || !/^[+-]?\d+$/.test(num ?? "")) return null;
  const v = /^[+-]/.test(num) ? { delta: Number(num) } : { value: Number(num) };
  if (c === "hp") return { name: "setResource", args: { actorName: who, resource: "hp", ...v } };
  if (RES.includes(c)) return { name: "setResource", args: { actorName: who, resource: c, ...v } };
  return null;
}
