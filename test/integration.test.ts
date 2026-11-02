// Live tmux integration test. Skipped unless OPENCODE_TMUX_TEST=1, since it
// needs a running tmux server and creates throwaway sessions.

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerTools } from "../src/tools.js"
import { killArgv, newArgv, run, sendKeysArgv, sessionForArgv } from "../src/tmux.js"

const enabled = process.env.OPENCODE_TMUX_TEST === "1"
const SESSION = "ocprobe-int"
const WINDOW_SESSION = "ocprobe-fix"

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

  // Defect 1: new-window wants a session target, not a pane id.
  test("new-window targets the resolved session", async () => {
    const cleanup = async () => {
      await run(["kill-session", "-t", WINDOW_SESSION])
    }
    try {
      const created = await run(["new-session", "-d", "-s", WINDOW_SESSION, "-x", "80", "-y", "24"])
      expect(created.code).toBe(0)

      const split = await run(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", WINDOW_SESSION])
      expect(split.code).toBe(0)
      const paneId = split.stdout.trim()

      const sessionRes = await run(sessionForArgv(paneId))
      expect(sessionRes.code).toBe(0)
      const session = sessionRes.stdout.trim()
      expect(session).toMatch(/^\$/)

      const windowRes = await run(newArgv(session, { kind: "window" }))
      expect(windowRes.code).toBe(0)
      const windowId = windowRes.stdout.trim()
      expect(windowId.startsWith("@")).toBe(true)

      await run(["kill-window", "-t", windowId])
    } finally {
      await cleanup()
    }
  })

  // tmux_new and tmux_kill, through the builders.
  test("tmux_new creates a pane and tmux_kill removes it", async () => {
    const NEW_SESSION = "ocprobe-new"
    const cleanup = async () => {
      await run(["kill-session", "-t", NEW_SESSION])
    }
    try {
      const created = await run(["new-session", "-d", "-s", NEW_SESSION, "-x", "80", "-y", "24"])
      expect(created.code).toBe(0)

      const pane = await run(newArgv(NEW_SESSION, { kind: "pane" }))
      expect(pane.code).toBe(0)
      const paneId = pane.stdout.trim()
      expect(paneId.startsWith("%")).toBe(true)

      const killed = await run(killArgv("pane", paneId))
      expect(killed.code).toBe(0)
    } finally {
      await cleanup()
    }
  })

  // tmux_edit, through the builder: the pane must end up running the editor.
  test("tmux_edit opens vim in a pane", async () => {
    const EDIT_SESSION = "ocprobe-edit"
    const dir = mkdtempSync(join(tmpdir(), "ocprobe-edit-"))
    const file = join(dir, "note.txt")
    const cleanup = async () => {
      await run(["kill-session", "-t", EDIT_SESSION])
      rmSync(dir, { recursive: true, force: true })
    }
    try {
      writeFileSync(file, "hello\n")
      const created = await run(["new-session", "-d", "-s", EDIT_SESSION, "-x", "80", "-y", "24"])
      expect(created.code).toBe(0)

      const command = `exec 'vim' '${file}'`
      const pane = await run(newArgv(EDIT_SESSION, { kind: "pane", place: "right", command, focus: true }))
      expect(pane.code).toBe(0)
      const paneId = pane.stdout.trim()

      let cmd = ""
      for (let i = 0; i < 40; i++) {
        const res = await run(["display-message", "-p", "-t", paneId, "-F", "#{pane_current_command}"])
        cmd = res.stdout.trim()
        if (cmd === "vim") break
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(cmd).toBe("vim")

      await run(killArgv("pane", paneId))
    } finally {
      await cleanup()
    }
  })

  // tmux_exec, driven through the real tool: create a pane, run a command, read
  // the output, then clean up.
  test("tmux_exec returns a command's output from a new pane", async () => {
    const EXEC_SESSION = "ocprobe-exec"
    const tools = new Map<string, { execute: (args: unknown, context: unknown) => Promise<{ content: string }> }>()
    const ctx = {
      options: { editor: "nano" },
      permission: { assert: async () => {} },
      tool: {
        transform: async (cb: (editor: unknown) => void) => {
          cb({ add: (tool: { name: string }) => tools.set(tool.name, tool as never) })
          return { dispose: async () => {} }
        },
      },
    }
    const cleanup = async () => {
      await run(["kill-session", "-t", EXEC_SESSION])
    }
    try {
      const created = await run(["new-session", "-d", "-s", EXEC_SESSION, "-x", "80", "-y", "24"])
      expect(created.code).toBe(0)

      await registerTools(ctx as never, run, {} as NodeJS.ProcessEnv, {
        exec: async () => 0,
        isDirectory: () => false,
      })
      const exec = tools.get("tmux_exec")!
      const result = await exec.execute(
        { command: "echo tmux_exec_marker", new: "pane", target: EXEC_SESSION, timeoutMs: 3000 },
        { sessionID: "ses", agent: "a", messageID: "m", id: "c" },
      )
      expect(result.content).toContain("tmux_exec_marker")
    } finally {
      await cleanup()
    }
  })
})
