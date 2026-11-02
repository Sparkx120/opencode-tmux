import { describe, expect, test } from "bun:test"
import {
  captureArgv,
  CONTEXT_FORMAT,
  contextArgv,
  nameArgv,
  newPaneArgv,
  newWindowArgv,
  resolveTarget,
  sendKeysArgv,
  settleCapture,
} from "../src/tmux.js"

describe("resolveTarget precedence", () => {
  test("explicit argument wins", () => {
    expect(resolveTarget("%1", "%2", { TMUX_PANE: "%3" } as NodeJS.ProcessEnv)).toBe("%1")
  })

  test("plugin option beats the environment", () => {
    expect(resolveTarget(undefined, "%2", { TMUX_PANE: "%3" } as NodeJS.ProcessEnv)).toBe("%2")
  })

  test("environment is the last fallback", () => {
    expect(resolveTarget(undefined, undefined, { TMUX_PANE: "%3" } as NodeJS.ProcessEnv)).toBe("%3")
  })

  test("undefined when nothing is set", () => {
    expect(resolveTarget(undefined, undefined, {} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  test("empty strings fall through", () => {
    expect(resolveTarget(undefined, "", { TMUX_PANE: "" } as NodeJS.ProcessEnv)).toBeUndefined()
  })

  test("defaults to process.env when the env argument is omitted", () => {
    const saved = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%9"
    try {
      expect(resolveTarget(undefined, undefined)).toBe("%9")
    } finally {
      if (saved === undefined) delete process.env.TMUX_PANE
      else process.env.TMUX_PANE = saved
    }
  })
})

describe("contextArgv", () => {
  test("builds agent-pane and pane-list commands when a target is present", () => {
    expect(contextArgv("%6")).toEqual([
      ["display-message", "-p", "-t", "%6", "-F", CONTEXT_FORMAT],
      ["list-panes", "-a", "-F", CONTEXT_FORMAT],
    ])
  })

  test("omits the agent-pane command without a target", () => {
    expect(contextArgv(undefined)).toEqual([["list-panes", "-a", "-F", CONTEXT_FORMAT]])
  })

  test("format string names the fields the skill documents", () => {
    expect(CONTEXT_FORMAT).toBe(
      "#{session_name}:#{window_index}.#{pane_index} pane_id=#{pane_id} title=#{pane_title} cmd=#{pane_current_command}",
    )
  })
})

describe("nameArgv", () => {
  test("names a pane with select-pane -T", () => {
    expect(nameArgv("pane", "%6", "worker")).toEqual(["select-pane", "-t", "%6", "-T", "worker"])
  })

  test("names a window with rename-window", () => {
    expect(nameArgv("window", "@1", "logs")).toEqual(["rename-window", "-t", "@1", "logs"])
  })
})

describe("newPaneArgv", () => {
  test("defaults to a vertical split and prints the pane id", () => {
    expect(newPaneArgv("%6", {})).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
  })

  test("horizontal split uses -h", () => {
    expect(newPaneArgv("%6", { vertical: false })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
    ])
  })

  test("appends a shell command as the final arguments", () => {
    expect(newPaneArgv("%6", { vertical: true, command: "htop" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
      "htop",
    ])
  })
})

describe("newWindowArgv", () => {
  test("prints the window id with no name or command", () => {
    expect(newWindowArgv({})).toEqual(["new-window", "-d", "-P", "-F", "#{window_id}"])
  })

  test("adds -n for a name and the command last", () => {
    expect(newWindowArgv({ name: "logs", command: "tail -f app.log" })).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-n",
      "logs",
      "tail -f app.log",
    ])
  })
})

describe("sendKeysArgv", () => {
  test("literal text plus a separate Enter by default", () => {
    expect(sendKeysArgv("%6", "ls -la", {})).toEqual([
      ["send-keys", "-t", "%6", "-l", "ls -la"],
      ["send-keys", "-t", "%6", "Enter"],
    ])
  })

  test("drops -l when literal is false", () => {
    expect(sendKeysArgv("%6", "C-c", { literal: false, enter: false })).toEqual([
      ["send-keys", "-t", "%6", "C-c"],
    ])
  })
})

describe("captureArgv", () => {
  test("plain capture", () => {
    expect(captureArgv("%6", {})).toEqual(["capture-pane", "-p", "-t", "%6"])
  })

  test("range and escapes", () => {
    expect(captureArgv("%6", { start: "-20", end: "-1", escapes: true })).toEqual([
      "capture-pane",
      "-p",
      "-t",
      "%6",
      "-S",
      "-20",
      "-E",
      "-1",
      "-e",
    ])
  })
})

describe("settleCapture", () => {
  test("returns once two consecutive reads match", async () => {
    let n = 0
    const reads = ["a", "a", "a"]
    const out = await settleCapture(async () => reads[n++] ?? "a", { timeoutMs: 50, pollMs: 1 })
    expect(out).toBe("a")
    expect(n).toBe(2)
  })

  test("keeps the newest value while it changes, then stabilizes", async () => {
    const reads = ["a", "b", "c", "c"]
    let n = 0
    const out = await settleCapture(async () => reads[n++] ?? "c", { timeoutMs: 200, pollMs: 1 })
    expect(out).toBe("c")
  })

  test("returns the last read when it never settles before the timeout", async () => {
    let n = 0
    const out = await settleCapture(async () => `tick ${n++}`, { timeoutMs: 20, pollMs: 1 })
    expect(out).toMatch(/^tick /)
    expect(n).toBeGreaterThan(1)
  })
})
