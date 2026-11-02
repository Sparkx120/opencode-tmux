import { describe, expect, test } from "bun:test"
import {
  bracketedCommand,
  captureArgv,
  CONTEXT_FORMAT,
  contextArgv,
  execMarker,
  extractExecOutput,
  killArgv,
  nameArgv,
  newArgv,
  sendKeysArgv,
  settleCapture,
  sessionForArgv,
  targetExistsArgv,
  windowForArgv,
} from "../src/tmux.js"

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

describe("newArgv", () => {
  test("the default pane split matches the old detached vertical split", () => {
    expect(newArgv("%6", { kind: "pane" })).toEqual([
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

  test("maps every pane place", () => {
    expect(newArgv("%6", { kind: "pane", place: "bottom" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
    expect(newArgv("%6", { kind: "pane", place: "top" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
      "-b",
    ])
    expect(newArgv("%6", { kind: "pane", place: "right" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
    ])
    expect(newArgv("%6", { kind: "pane", place: "left" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
      "-b",
    ])
  })

  test("passes a pane size to -l after the place", () => {
    expect(newArgv("%6", { kind: "pane", size: "20" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
      "-l",
      "20",
    ])
    expect(newArgv("%6", { kind: "pane", place: "right", size: "30%" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
      "-l",
      "30%",
    ])
  })

  test("focus omits -d so the new pane becomes active", () => {
    expect(newArgv("%6", { kind: "pane", focus: true })).toEqual([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
  })

  test("wraps a pane command in the configured shell", () => {
    expect(newArgv("%6", { kind: "pane", command: "htop" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
      "sh",
      "-c",
      "htop",
    ])
    expect(newArgv("%6", { kind: "pane", command: "echo hi", shell: "bash" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
      "bash",
      "-c",
      "echo hi",
    ])
  })

  test("the default window targets a session and inserts after", () => {
    expect(newArgv("$3:", { kind: "window" })).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
    ])
  })

  test("maps window place, name, command, and focus", () => {
    expect(newArgv("$3:", { kind: "window", place: "before" })).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-b",
    ])
    expect(newArgv("$3:", { kind: "window", name: "logs" })).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
      "-n",
      "logs",
    ])
    expect(newArgv("$3:", { kind: "window", command: "echo hi" })).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
      "sh",
      "-c",
      "echo hi",
    ])
    expect(newArgv("$3:", { kind: "window", focus: true })).toEqual([
      "new-window",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
    ])
  })
})

describe("killArgv", () => {
  test("kills a pane or a window by target", () => {
    expect(killArgv("pane", "%6")).toEqual(["kill-pane", "-t", "%6"])
    expect(killArgv("window", "@1")).toEqual(["kill-window", "-t", "@1"])
  })
})

describe("windowForArgv", () => {
  test("asks tmux for the window id of a target", () => {
    expect(windowForArgv("%6")).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{window_id}"])
  })
})

describe("sendKeysArgv", () => {
  test("literal text plus a separate Enter by default", () => {
    expect(sendKeysArgv("%6", "ls -la", {})).toEqual([
      ["send-keys", "-t", "%6", "-l", "--", "ls -la"],
      ["send-keys", "-t", "%6", "Enter"],
    ])
  })

  test("terms with -- so leading-dash text is not read as a flag", () => {
    expect(sendKeysArgv("%6", "-n dash", {})).toEqual([
      ["send-keys", "-t", "%6", "-l", "--", "-n dash"],
      ["send-keys", "-t", "%6", "Enter"],
    ])
    expect(sendKeysArgv("%6", "--help", {})).toEqual([
      ["send-keys", "-t", "%6", "-l", "--", "--help"],
      ["send-keys", "-t", "%6", "Enter"],
    ])
  })

  test("drops -l when literal is false", () => {
    expect(sendKeysArgv("%6", "C-c", { literal: false, enter: false })).toEqual([
      ["send-keys", "-t", "%6", "--", "C-c"],
    ])
  })
})

describe("targetExistsArgv", () => {
  test("asks tmux for the pane id of a target", () => {
    expect(targetExistsArgv("%6")).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{pane_id}"])
  })
})

describe("sessionForArgv", () => {
  test("asks tmux for the session of a target, colon-terminated", () => {
    expect(sessionForArgv("%6")).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{session_id}:"])
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

describe("execMarker", () => {
  test("is a unique, shell-safe token", () => {
    const a = execMarker()
    const b = execMarker()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_]+$/)
  })
})

describe("bracketedCommand", () => {
  test("wraps the command between a begin and an exit-code sentinel on one line", () => {
    expect(bracketedCommand("echo hi", "M")).toBe('echo M-B; echo hi; echo "M-E:$?"')
  })
})

describe("extractExecOutput", () => {
  const cap = (lines: string[]) => lines.join("\n")

  test("returns the lines between the last begin and its end marker", () => {
    const capture = cap([
      'echo M-B; ls; echo "M-E:$?"',
      "M-B",
      "file-a",
      "file-b",
      "M-E:0",
      "┌─[user@host]─[/home]",
      "└─ ls",
    ])
    expect(extractExecOutput(capture, "M")).toEqual({ text: "file-a\nfile-b", exit: 0, bounded: true })
  })

  test("uses the last begin marker when old content holds an earlier one", () => {
    const capture = cap(["M-B", "stale output", "M-E:0", 'echo M-B; x; echo "M-E:$?"', "M-B", "fresh", "M-E:2"])
    expect(extractExecOutput(capture, "M")).toEqual({ text: "fresh", exit: 2, bounded: true })
  })

  test("trims surrounding blank lines", () => {
    const capture = cap(["M-B", "", "out", "", "M-E:0"])
    expect(extractExecOutput(capture, "M")).toEqual({ text: "out", exit: 0, bounded: true })
  })

  test("empty output yields an empty body", () => {
    expect(extractExecOutput(cap(["M-B", "M-E:0"]), "M")).toEqual({ text: "", exit: 0, bounded: true })
  })

  test("falls back to the raw capture when the markers are missing", () => {
    const out = extractExecOutput(cap(["some", "raw", "output"]), "M")
    expect(out).toEqual({ text: "some\nraw\noutput", exit: undefined, bounded: false })
  })

  test("reports an unknown exit when the end marker has no number", () => {
    expect(extractExecOutput(cap(["M-B", "out", "M-E:?"]), "M")).toEqual({
      text: "out",
      exit: undefined,
      bounded: true,
    })
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
