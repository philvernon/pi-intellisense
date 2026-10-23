import test from "node:test";
import assert from "node:assert/strict";

/**
 * NT-09: user's Neovim config uses folke/sidekick.nvim +
 * ~/dev-trash/pi-tools with tmux -L agents. Pi runs in that terminal,
 * not in a native Neovim source buffer.
 */
const host = () => import("../../src/native/neovim-host.ts");

test("NT-09: configured Neovim socket wins over NVIM inherited through Sidekick", async () => {
  const { resolveNeovimHost } = await host();
  const choice = resolveNeovimHost({
    config: { socket: "/tmp/host.nvim", focusPolicy: "preserve" },
    env: { NVIM: "/tmp/old-terminal.nvim", TMUX: "/tmp/tmux-agents/server,3,1" },
    sidekick: { tmuxServer: "agents", backend: "tmux" }
  });
  assert.equal(choice.socket, "/tmp/host.nvim");
  assert.equal(choice.focusPolicy, "preserve");
  assert.equal(choice.spawnEditor, false);
});

test("NT-09: absent NVIM in detached tmux requires explicit socket, never guesses processes", async () => {
  const { resolveNeovimHost } = await host();
  const choice = resolveNeovimHost({
    config: {},
    env: { TMUX: "/tmp/tmux-agents/server,3,1" },
    sidekick: { tmuxServer: "agents", backend: "tmux" }
  });
  assert.equal(choice, null);
});

test("NT-09: Neovim location handoff uses existing client without launching or stealing host focus", async () => {
  const { createNeovimHandoff } = await host();
  const calls = [];
  const gateway = createNeovimHandoff({
    socket: "/tmp/host.nvim",
    connect: async name => {
      assert.equal(name, "/tmp/host.nvim");
      return { async open(location) { calls.push(location); }, close() {} };
    },
    focusHost() { throw new Error("must not steal Sidekick/Neovim focus by default"); },
    spawn() { throw new Error("must not start new Neovim or tmux instance"); },
    focusPolicy: "preserve"
  });
  await gateway.open({ uri: "file:///project/a.ts", line: 8, character: 3 });
  assert.deepEqual(calls, [{ uri: "file:///project/a.ts", line: 8, character: 3 }]);
});
