// Live tmux integration test. Skipped unless OPENCODE_TMUX_TEST=1, since it
// needs a running tmux server and creates a throwaway session.

import { describe, expect, test } from "bun:test"
import { run, sendKeysArgv } from "../src/tmux.js"

const enabled = process.env.OPENCODE_TMUX_TEST === "1"
const SESSION = "ocprobe-int"

const sendAll = async (argvs: string[][]) => {
  for (const argv of argvs) {
    const res = await run(argv)
    expect(res.code).toBe(0)
  }
}

describe.skipIf(!enabled)("live tmux integration", () => {
  test("split, send, capture, then clean up", async () => {
    const cleanup = async () => {
      await run(["kill-session", "-t", SESSION])
    }
    try {
      const created = await run(["new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24"])
      expect(created.code).toBe(0)

      const split = await run(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", SESSION])
      expect(split.code).toBe(0)
      const paneId = split.stdout.trim()
      expect(paneId.startsWith("%")).toBe(true)

      await sendAll(sendKeysArgv(paneId, "echo hello", {}))

      let captured = ""
      for (let i = 0; i < 20; i++) {
        const res = await run(["capture-pane", "-p", "-t", paneId])
        captured = res.stdout
        if (captured.includes("hello")) break
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(captured).toContain("hello")

      // Defect 2: leading-dash literal text must not be read as a flag.
      await sendAll(sendKeysArgv(paneId, "-n dash-literal", {}))
      await sendAll(sendKeysArgv(paneId, "--help", {}))
      // The non-literal branch sends a key name; the -- terminator must not break it.
      await sendAll(sendKeysArgv(paneId, "C-c", { literal: false, enter: false }))

      await run(["kill-pane", "-t", paneId])
    } finally {
      await cleanup()
    }
  })
})
