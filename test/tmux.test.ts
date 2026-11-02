import { describe, expect, test } from "bun:test"
import {
  captureArgv,
  cleanExecCapture,
  CONTEXT_FORMAT,
  contextArgv,
  execTimeoutTrailer,
  execTrailer,
  killArgv,
  nameArgv,
  nameDisableArgv,
  nameSequence,
  newArgv,
  paneDeadArgv,
  paneDeadStatusArgv,
  paneOptionArgv,
  respawnArgv,
  sendKeysArgv,
  settleCapture,
  sessionForArgv,
  targetExistsArgv,
  waitForPaneDead,
  windowForArgv,
  windowOptionArgv,
} from "../src/tmux.js"

describe("contextArgv", () => {
  test("builds agent-pane and pane-list commands when a target is present", () => {
    expect(contextArgv("%1")).toEqual([
      ["display-message", "-p", "-t", "%1", "-F", CONTEXT_FORMAT],
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
    expect(nameArgv("pane", "%1", "worker")).toEqual(["select-pane", "-t", "%1", "-T", "worker"])
  })

  test("names a window with rename-window", () => {
    expect(nameArgv("window", "@1", "logs")).toEqual(["rename-window", "-t", "@1", "logs"])
  })
})

describe("nameDisableArgv", () => {
  test("turns a pane's own title off before it is named", () => {
    expect(nameDisableArgv("pane", "%1")).toEqual(["set-option", "-p", "-t", "%1", "allow-set-title", "off"])
  })

  test("turns a window's own rename off before it is named", () => {
    expect(nameDisableArgv("window", "@1")).toEqual(["set-option", "-w", "-t", "@1", "allow-rename", "off"])
  })
})

describe("nameSequence", () => {
  test("disables the program's title, then names the pane", () => {
    expect(nameSequence("pane", "%1", "worker")).toEqual([
      ["set-option", "-p", "-t", "%1", "allow-set-title", "off"],
      ["select-pane", "-t", "%1", "-T", "worker"],
    ])
  })

  test("disables the program's rename, then names the window", () => {
    expect(nameSequence("window", "@1", "logs")).toEqual([
      ["set-option", "-w", "-t", "@1", "allow-rename", "off"],
      ["rename-window", "-t", "@1", "logs"],
    ])
  })
})

describe("windowOptionArgv", () => {
  test("sets an option on the window itself", () => {
    expect(windowOptionArgv("@1", "allow-rename", "off")).toEqual([
      "set-option",
      "-w",
      "-t",
      "@1",
      "allow-rename",
      "off",
    ])
  })
})

describe("newArgv", () => {
  test("the default pane split matches the old detached vertical split", () => {
    expect(newArgv("%1", { kind: "pane" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
    ])
  })

  test("maps every pane place", () => {
    expect(newArgv("%1", { kind: "pane", place: "bottom" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
    ])
    expect(newArgv("%1", { kind: "pane", place: "top" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
      "-b",
    ])
    expect(newArgv("%1", { kind: "pane", place: "right" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-h",
    ])
    expect(newArgv("%1", { kind: "pane", place: "left" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-h",
      "-b",
    ])
  })

  test("passes a pane size to -l after the place", () => {
    expect(newArgv("%1", { kind: "pane", size: "20" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
      "-l",
      "20",
    ])
    expect(newArgv("%1", { kind: "pane", place: "right", size: "30%" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-h",
      "-l",
      "30%",
    ])
  })

  test("focus omits -d so the new pane becomes active", () => {
    expect(newArgv("%1", { kind: "pane", focus: true })).toEqual([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
    ])
  })

  test("wraps a pane command in the configured shell", () => {
    expect(newArgv("%1", { kind: "pane", command: "htop" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
      "-v",
      "sh",
      "-c",
      "htop",
    ])
    expect(newArgv("%1", { kind: "pane", command: "echo hi", shell: "bash" })).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%1",
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

  test("maps window place, command, and focus", () => {
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
    expect(killArgv("pane", "%1")).toEqual(["kill-pane", "-t", "%1"])
    expect(killArgv("window", "@1")).toEqual(["kill-window", "-t", "@1"])
  })
})

describe("windowForArgv", () => {
  test("asks tmux for the window id of a target", () => {
    expect(windowForArgv("%1")).toEqual(["display-message", "-p", "-t", "%1", "-F", "#{window_id}"])
  })
})

describe("sendKeysArgv", () => {
  test("literal text plus a separate Enter by default", () => {
    expect(sendKeysArgv("%1", "ls -la", {})).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", "ls -la"],
      ["send-keys", "-t", "%1", "Enter"],
    ])
  })

  test("terms with -- so leading-dash text is not read as a flag", () => {
    expect(sendKeysArgv("%1", "-n dash", {})).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", "-n dash"],
      ["send-keys", "-t", "%1", "Enter"],
    ])
    expect(sendKeysArgv("%1", "--help", {})).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", "--help"],
      ["send-keys", "-t", "%1", "Enter"],
    ])
  })

  test("drops -l when literal is false", () => {
    expect(sendKeysArgv("%1", "C-c", { literal: false, enter: false })).toEqual([
      ["send-keys", "-t", "%1", "--", "C-c"],
    ])
  })
})

describe("targetExistsArgv", () => {
  test("asks tmux for the pane id of a target", () => {
    expect(targetExistsArgv("%1")).toEqual(["display-message", "-p", "-t", "%1", "-F", "#{pane_id}"])
  })
})

describe("sessionForArgv", () => {
  test("asks tmux for the session of a target, colon-terminated", () => {
    expect(sessionForArgv("%1")).toEqual(["display-message", "-p", "-t", "%1", "-F", "#{session_id}:"])
  })
})

describe("captureArgv", () => {
  test("plain capture", () => {
    expect(captureArgv("%1", {})).toEqual(["capture-pane", "-p", "-t", "%1"])
  })

  test("range and escapes", () => {
    expect(captureArgv("%1", { start: "-20", end: "-1", escapes: true })).toEqual([
      "capture-pane",
      "-p",
      "-t",
      "%1",
      "-S",
      "-20",
      "-E",
      "-1",
      "-e",
    ])
  })
})

describe("paneOptionArgv", () => {
  test("sets a pane option on the pane itself", () => {
    expect(paneOptionArgv("%1", "remain-on-exit", "on")).toEqual([
      "set-option",
      "-p",
      "-t",
      "%1",
      "remain-on-exit",
      "on",
    ])
  })

  test("an empty value is passed as its own element", () => {
    expect(paneOptionArgv("%1", "remain-on-exit-format", "")).toEqual([
      "set-option",
      "-p",
      "-t",
      "%1",
      "remain-on-exit-format",
      "",
    ])
  })
})

describe("respawnArgv", () => {
  test("passes the shell, the flag, and the command as separate elements", () => {
    expect(respawnArgv("%1", "sh", "echo hi")).toEqual(["respawn-pane", "-k", "-t", "%1", "sh", "-c", "echo hi"])
  })

  test("keeps pipes, quotes, and globs intact in one element", () => {
    expect(respawnArgv("%1", "bash", 'echo "a|b" | tr a-z A-Z && ls *.ts')).toEqual([
      "respawn-pane",
      "-k",
      "-t",
      "%1",
      "bash",
      "-c",
      'echo "a|b" | tr a-z A-Z && ls *.ts',
    ])
  })
})

describe("pane dead probes", () => {
  test("paneDeadArgv asks for the dead flag", () => {
    expect(paneDeadArgv("%1")).toEqual(["display-message", "-p", "-t", "%1", "-F", "#{pane_dead}"])
  })

  test("paneDeadStatusArgv asks for the exit status", () => {
    expect(paneDeadStatusArgv("%1")).toEqual(["display-message", "-p", "-t", "%1", "-F", "#{pane_dead_status}"])
  })
})

describe("cleanExecCapture", () => {
  test("trims the pane's trailing blank padding", () => {
    expect(cleanExecCapture("out-a\npipe ABC\n\n\n\n")).toBe("out-a\npipe ABC")
  })

  test("strips a dead-pane banner line and the blanks around it", () => {
    expect(cleanExecCapture("out\n\nPane is dead (status 3, Mon Jan 1 00:00:00 2024)\n\n")).toBe("out")
  })

  test("an empty capture stays empty", () => {
    expect(cleanExecCapture("\n\n\n")).toBe("")
  })
})

describe("exec trailer", () => {
  test("names only the exit status on the success path", () => {
    expect(execTrailer(0)).toBe("[tmux_exec: exit 0]")
    expect(execTrailer(2)).toBe("[tmux_exec: exit 2]")
    expect(execTrailer(undefined)).toBe("[tmux_exec: exit ?]")
  })

  test("names the pane and the wait on the timeout path", () => {
    expect(execTimeoutTrailer(800, "%42")).toBe("[tmux_exec: still running after 800ms, pane %42]")
  })
})

describe("waitForPaneDead", () => {
  test("returns true once the pane reads dead", async () => {
    const reads = ["0\n", "0\n", "1\n"]
    let n = 0
    const out = await waitForPaneDead(async () => reads[Math.min(n++, reads.length - 1)]!, { timeoutMs: 200, pollMs: 1 })
    expect(out).toBe(true)
    expect(n).toBe(3)
  })

  test("returns false when the deadline passes while the pane lives", async () => {
    let n = 0
    const out = await waitForPaneDead(async () => `0\n${n++}`, { timeoutMs: 20, pollMs: 1 })
    expect(out).toBe(false)
    expect(n).toBeGreaterThan(1)
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
