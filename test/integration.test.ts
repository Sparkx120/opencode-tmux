// Live tmux integration test. Skipped unless OPENCODE_TMUX_TEST=1, since it
// needs a running tmux server and creates a throwaway session.

import { describe, expect, test } from "bun:test"
import { run } from "../src/tmux.js"

const enabled = process.env.OPENCODE_TMUX_TEST === "1"
const SESSION = "ocprobe-int"

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

      const sent = await run(["send-keys", "-t", paneId, "-l", "echo hello"])
      expect(sent.code).toBe(0)
      const enter = await run(["send-keys", "-t", paneId, "Enter"])
      expect(enter.code).toBe(0)

      let captured = ""
      for (let i = 0; i < 20; i++) {
        const res = await run(["capture-pane", "-p", "-t", paneId])
        captured = res.stdout
        if (captured.includes("hello")) break
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(captured).toContain("hello")

      await run(["kill-pane", "-t", paneId])
    } finally {
      await cleanup()
    }
  })
})
