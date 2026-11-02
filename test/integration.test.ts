// Live tmux integration test. Skipped unless OPENCODE_TMUX_TEST=1, since it
// needs a running tmux server and creates throwaway sessions.

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { registerTools } from "../src/tools.js"
import { killArgv, newArgv, run, sendKeysArgv, sessionForArgv } from "../src/tmux.js"

const enabled = process.env.OPENCODE_TMUX_TEST === "1"
const SESSION = "ocprobe-int"
const WINDOW_SESSION = "ocprobe-fix"
// The repository root, derived from this file's location so the live case does
// not depend on where the checkout lives.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

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

  // tmux_exec, driven through the real tool: it creates its own pane, runs the
  // command as that pane's process, returns the output plus the exit trailer,
  // and closes the pane. Nothing is typed into it, and nothing is left behind.
  test("tmux_exec runs in its own pane and closes it", async () => {
    const EXEC_SESSION = "ocprobe-exec"
    const tools = new Map<string, { execute: (args: unknown, context: unknown) => Promise<{ content: string }> }>()
    const cleanup = async () => {
      await run(["kill-session", "-t", EXEC_SESSION])
    }
    // The pane ids in the throwaway session, sorted, so a run can be shown to
    // leave nothing behind.
    const paneIds = async () => {
      const res = await run(["list-panes", "-t", EXEC_SESSION, "-F", "#{pane_id}"])
      return res.stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .sort()
    }
    try {
      const created = await run(["new-session", "-d", "-s", EXEC_SESSION, "-x", "200", "-y", "24"])
      expect(created.code).toBe(0)
      const anchorPane = (await run(["display-message", "-p", "-t", EXEC_SESSION, "-F", "#{pane_id}"])).stdout.trim()
      expect(anchorPane.startsWith("%")).toBe(true)

      const ctx = {
        options: { editor: "nano", pane: anchorPane },
        permission: { assert: async () => {} },
        tool: {
          transform: async (cb: (editor: unknown) => void) => {
            cb({ add: (tool: { name: string }) => tools.set(tool.name, tool as never) })
            return { dispose: async () => {} }
          },
        },
      }
      await registerTools(ctx as never, run, {} as NodeJS.ProcessEnv, {
        exec: async () => 0,
        isDirectory: () => false,
      })
      const exec = tools.get("tmux_exec")!
      const context = { sessionID: "ses", agent: "a", messageID: "m", id: "c" }
      const before = await paneIds()

      // A known output: present, and neither the command echo nor the banner.
      const okCase = await exec.execute({ command: "echo tmux_exec_marker", timeoutMs: 3000 }, context)
      expect(okCase.content).toContain("tmux_exec_marker")
      expect(okCase.content).not.toContain("echo tmux_exec_marker")
      expect(okCase.content).not.toContain("Pane is dead")
      expect(okCase.content).toMatch(/\[tmux_exec: exit 0\]/)

      // A real listing: pipes and quotes reach the command intact.
      const lsCase = await exec.execute({ command: `ls '${REPO_ROOT}' | cat`, timeoutMs: 3000 }, context)
      expect(lsCase.content).toContain("package.json")
      expect(lsCase.content).toContain("index.ts")
      expect(lsCase.content).toMatch(/\[tmux_exec: exit 0\]/)

      // A failing command: the real, non-zero exit status is surfaced.
      const failCase = await exec.execute({ command: "ls /nonexistent-xyz-123", timeoutMs: 3000 }, context)
      expect(failCase.content).not.toContain("Pane is dead")
      expect(failCase.content).toMatch(/\[tmux_exec: exit \d+\]/)
      expect(failCase.content).not.toMatch(/\[tmux_exec: exit 0\]/)

      // A window is created, used, and closed too.
      const windowCase = await exec.execute({ command: "echo window_marker", new: "window", timeoutMs: 3000 }, context)
      expect(windowCase.content).toContain("window_marker")
      expect(windowCase.content).toMatch(/\[tmux_exec: exit 0\]/)

      // Nothing the completed runs created is left behind.
      expect(await paneIds()).toEqual(before)

      // A command that outlives the timeout is left running and named.
      const slowCase = await exec.execute({ command: "sleep 30", timeoutMs: 300 }, context)
      expect(slowCase.content).toMatch(/\[tmux_exec: still running after 300ms, pane %\d+\]/)
      const leftPane = /pane (%\d+)\]/.exec(slowCase.content)![1]!
      const stillThere = await run(["display-message", "-p", "-t", leftPane, "-F", "#{pane_id}"])
      expect(stillThere.stdout.trim()).toBe(leftPane)
      expect(await paneIds()).toContain(leftPane)

      // Clean up the pane the timed-out command left behind, and confirm it is gone.
      expect((await run(killArgv("pane", leftPane))).code).toBe(0)
      const gone = await run(["display-message", "-p", "-t", leftPane, "-F", "#{pane_id}"])
      expect(gone.stdout.trim()).toBe("")
    } finally {
      await cleanup()
    }
  })
})
