// Foundry v14 movement is async: wait for the token to report the target position (updateToken hook) or time out.
export function waitForPosition(token, x, y, { on, off, timeoutMs = 4000, setT = (f, ms) => setTimeout(f, ms), clearT = (t) => clearTimeout(t) }) {
  const at = () => token.x === x && token.y === y;
  if (at()) return Promise.resolve({ reached: true, x: token.x, y: token.y });
  return new Promise((resolve) => {
    let id, timer;
    const done = (reached) => { off("updateToken", id); clearT(timer); resolve({ reached, x: token.x, y: token.y }); };
    id = on("updateToken", (doc) => { if (doc?.id === token.id && at()) done(true); });
    timer = setT(() => done(at()), timeoutMs);
  });
}
