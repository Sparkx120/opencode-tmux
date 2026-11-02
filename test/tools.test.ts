import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerTools as registerToolsImpl } from "../src/tools.js"
import { PANE_LIST_FORMAT } from "../src/anchor.js"
import { CONTEXT_FORMAT } from "../src/tmux.js"
import type { RunResult, Runner } from "../src/tmux.js"
const EMPTY_ENV = {} as NodeJS.ProcessEnv

// The NERDTree probe and the directory check are injected so no editor runs in
// these tests. Tests that need different behaviour pass their own deps.
const DEPS = { exec: async () => 0, isDirectory: () => false }
const registerTools = (
  ctx: Plugin.Context,
  runner: Runner,
  env: NodeJS.ProcessEnv = EMPTY_ENV,
  deps = DEPS,
) => registerToolsImpl(ctx, runner, env, deps)

interface Captured {
  name: string
  description: string
  input: unknown
  execute: (args: unknown, context: unknown) => Promise<{ content: string }>
}

interface AssertCall {
  action: string
  resources: string[]
  save?: string[]
  sessionID: string
  agent?: string
  source?: { type: string; messageID: string; id: string }
}

function fakeCtx(
  options: Record<string, unknown> = {},
  assertImpl: (input: AssertCall) => Promise<void> = async () => {},
  directory?: string,
): { ctx: Plugin.Context; tools: Map<string, Captured>; assertCalls: AssertCall[] } {
  const tools = new Map<string, Captured>()
  const assertCalls: AssertCall[] = []
  const ctx = {
    options,
    location: directory ? { directory } : undefined,
    permission: {
      assert: async (input: AssertCall) => {
        assertCalls.push(input)
        await assertImpl(input)
      },
    },
    tool: {
      transform: async (cb: (editor: unknown) => void) => {
        const editor = {
          add: (tool: Captured) => {
            tools.set(tool.name, tool)
          },
        }
        cb(editor)
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context
  return { ctx, tools, assertCalls }
}

const TEST_CONTEXT = { sessionID: "ses_test", agent: "build", messageID: "msg_x", id: "call_x" }

const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0, message: "" })
const bad = (message: string): RunResult => ({ stdout: "", stderr: message, code: 1, message })

// The probes are display-messages distinguished by their format; the anchor
// heuristic lists panes.
const targetOf = (argv: string[]) => {
  const i = argv.indexOf("-t")
  return i >= 0 ? (argv[i + 1] ?? "") : ""
}
const isProbe = (argv: string[]) => argv[0] === "display-message" && argv[argv.length - 1] === "#{pane_id}"
const isSessionProbe = (argv: string[]) => argv[0] === "display-message" && argv[argv.length - 1] === "#{session_id}:"
const isWindowProbe = (argv: string[]) => argv[0] === "display-message" && argv[argv.length - 1] === "#{window_id}"
const isPaneList = (argv: string[]) => argv[0] === "list-panes"

function tmuxRunner(respond: (argv: string[]) => RunResult): { runner: Runner; calls: string[][] } {
  const calls: string[][] = []
  const runner: Runner = async (argv) => {
    calls.push(argv)
    return respond(argv)
  }
  return { runner, calls }
}

// Default responder: the pane probe echoes the target pane id, the session and
// window probes answer for it, every other command succeeds.
const anchorExists = (stdout = "%9\n") => (argv: string[]) =>
  isProbe(argv)
    ? ok(`${targetOf(argv)}\n`)
    : isSessionProbe(argv)
      ? ok("$3:\n")
      : isWindowProbe(argv)
        ? ok(`${targetOf(argv).startsWith("@") ? targetOf(argv) : "@3"}\n`)
        : ok(stdout)

const TMUX_DIR = "/srv/work/app"
const PANE_LIST = ["%6\topencode\t/srv/other/tool", `%10\topencode\t${TMUX_DIR}`].join(
  "\n",
)

// Responder for the directory heuristic: answers the pane list plus the probes,
// with a configurable probe target.
const withPaneList = (probeTarget = "%10\n") => (argv: string[]) =>
  isPaneList(argv)
    ? ok(`${PANE_LIST}\n`)
    : isProbe(argv)
      ? ok(probeTarget)
      : isSessionProbe(argv)
        ? ok("$3:\n")
        : isWindowProbe(argv)
          ? ok("@3\n")
          : argv[0] === "display-message"
            ? ok("sess:0.1 pane_id=%10 title=x cmd=opencode\n")
            : ok("%9\n")

const NAMES = [
  "tmux_context",
  "tmux_new",
  "tmux_kill",
  "tmux_name",
  "tmux_send",
  "tmux_capture",
  "tmux_edit",
  "tmux_exec",
]

describe("registerTools", () => {
  test("registers exactly the eight tmux tools", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    expect([...tools.keys()].sort()).toEqual([...NAMES].sort())
  })

  test("every description carries the skill guidance", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    for (const name of NAMES) {
      const t = tools.get(name)!
      expect(t.description).toContain("tmux")
      expect(t.description.toLowerCase()).toContain("skill")
    }
  })

  test("input schemas are objects with additionalProperties false", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    for (const name of NAMES) {
      const schema = tools.get(name)!.input as { type: string; additionalProperties: boolean }
      expect(schema.type).toBe("object")
      expect(schema.additionalProperties).toBe(false)
    }
  })

  test("tools with no target respond with a helpful message instead of running tmux", async () => {
    const { ctx, tools } = fakeCtx()
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const send = await tools.get("tmux_send")!.execute({ text: "hi" }, TEST_CONTEXT)
    expect(send.content).toContain("no tmux target")
    const capture = await tools.get("tmux_capture")!.execute({}, TEST_CONTEXT)
    expect(capture.content).toContain("no tmux target")
    const kill = await tools.get("tmux_kill")!.execute({ kind: "pane" }, TEST_CONTEXT)
    expect(kill.content).toContain("no tmux target")
    expect(calls.length).toBe(0)
  })

  test("tmux_send sends to an explicit target that is not the anchor", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_send")!.execute({ text: "ls", target: "%4" }, TEST_CONTEXT)
    expect(result.content).toContain("sent")
    const sends = calls.filter((argv) => argv[0] === "send-keys")
    expect(sends[0]).toEqual(["send-keys", "-t", "%4", "-l", "--", "ls"])
    expect(sends[1]).toEqual(["send-keys", "-t", "%4", "Enter"])
  })

  test("tmux_send refuses the anchor pane, omitted or explicit", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const omitted = await tools.get("tmux_send")!.execute({ text: "ls" }, TEST_CONTEXT)
    expect(omitted.content).toMatch(/refus/i)
    expect(omitted.content).toContain("another pane")
    const explicit = await tools.get("tmux_send")!.execute({ text: "ls", target: "%6" }, TEST_CONTEXT)
    expect(explicit.content).toMatch(/refus/i)
    expect(calls.some((argv) => argv[0] === "send-keys")).toBe(false)
  })

  test("tmux_new creates and names a detached pane", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new")!.execute({ kind: "pane", name: "worker" }, TEST_CONTEXT)
    expect(result.content).toContain("%42")
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
    expect(calls.find((argv) => argv[0] === "select-pane")).toEqual(["select-pane", "-t", "%42", "-T", "worker"])
  })

  test("tmux_new maps pane place and size", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new")!.execute({ kind: "pane", place: "right", size: "30%" }, TEST_CONTEXT)
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
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

  test("tmux_new focuses a pane when asked", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new")!.execute({ kind: "pane", focus: true }, TEST_CONTEXT)
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
  })

  test("tmux_new runs a pane command through the configured shell", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", shell: "bash" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new")!.execute({ kind: "pane", command: "ls | wc -l" }, TEST_CONTEXT)
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
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
      "ls | wc -l",
    ])
  })

  test("tmux_new resolves the session and creates a named window", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("@7\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new")!.execute({ kind: "window", name: "logs" }, TEST_CONTEXT)
    expect(result.content).toContain("@7")
    expect(calls.find(isSessionProbe)).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{session_id}:"])
    expect(calls.find((argv) => argv[0] === "new-window")).toEqual([
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
  })

  test("tmux_new rejects a window size", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new")!.execute({ kind: "window", size: "20" }, TEST_CONTEXT)
    expect(result.content).toContain("size")
    expect(calls.some((argv) => argv[0] === "new-window")).toBe(false)
  })

  test("tmux_new rejects an unknown kind or place", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    const kind = await tools.get("tmux_new")!.execute({ kind: "pane2" }, TEST_CONTEXT)
    expect(kind.content).toContain("kind")
    const place = await tools.get("tmux_new")!.execute({ kind: "pane", place: "after" }, TEST_CONTEXT)
    expect(place.content).toContain("place")
  })

  test("tmux_new reports when the window session cannot be resolved", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv) ? ok("%6\n") : isSessionProbe(argv) ? bad("no session") : ok("@7\n"),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new")!.execute({ kind: "window" }, TEST_CONTEXT)
    expect(result.content).toContain("does not exist")
    expect(calls.some((argv) => argv[0] === "new-window")).toBe(false)
  })

  test("tmux_kill kills a pane that is not the anchor", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_kill")!.execute({ kind: "pane", target: "%4" }, TEST_CONTEXT)
    expect(result.content).toContain("killed pane %4")
    expect(calls.find((argv) => argv[0] === "kill-pane")).toEqual(["kill-pane", "-t", "%4"])
  })

  test("tmux_kill kills a window that does not contain the anchor", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_kill")!.execute({ kind: "window", target: "@4" }, TEST_CONTEXT)
    expect(result.content).toContain("killed window @4")
    expect(calls.find((argv) => argv[0] === "kill-window")).toEqual(["kill-window", "-t", "@4"])
  })

  test("tmux_kill refuses the anchor pane, with no target or an explicit one", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const implicit = await tools.get("tmux_kill")!.execute({ kind: "pane" }, TEST_CONTEXT)
    expect(implicit.content).toMatch(/refus|anchor/i)
    const explicit = await tools.get("tmux_kill")!.execute({ kind: "pane", target: "%6" }, TEST_CONTEXT)
    expect(explicit.content).toMatch(/refus|anchor/i)
    expect(calls.some((argv) => argv[0] === "kill-pane")).toBe(false)
  })

  test("tmux_kill refuses the window that contains the anchor pane", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_kill")!.execute({ kind: "window", target: "@3" }, TEST_CONTEXT)
    expect(result.content).toMatch(/refus|anchor/i)
    expect(calls.some((argv) => argv[0] === "kill-window")).toBe(false)
  })

  test("tmux_kill rejects an unknown kind", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    const result = await tools.get("tmux_kill")!.execute({ kind: "session" }, TEST_CONTEXT)
    expect(result.content).toContain("kind")
  })

  test("tmux_send no longer requires a target in its schema", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    const schema = tools.get("tmux_send")!.input as { required: string[] }
    expect(schema.required).toContain("text")
    expect(schema.required).not.toContain("target")
  })

  test("tmux_capture returns captured text", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner } = tmuxRunner(anchorExists("hello world\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_capture")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("hello world")
  })

  test("tmux_context reports the agent pane and the pane list", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner } = tmuxRunner((argv) => (isProbe(argv) ? ok("%6\n") : ok("sess:0.1 pane_id=%6 title=x cmd=zsh\n")))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_context")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("pane_id=%6")
  })

  test("a failed tmux command becomes a text message, not a throw", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const runner: Runner = async (argv) => (isProbe(argv) ? ok("%6\n") : bad("can't find pane"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_capture")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("can't find pane")
  })
})

describe("anchor heuristic", () => {
  test("resolves the target from the session directory when no pane option is set", async () => {
    const { ctx, tools } = fakeCtx({}, async () => {}, TMUX_DIR)
    const { runner, calls } = tmuxRunner(withPaneList())
    await registerTools(ctx, runner, EMPTY_ENV)

    // tmux_new proves the default target without the tmux_send anchor refusal.
    const result = await tools.get("tmux_new")!.execute({ kind: "pane" }, TEST_CONTEXT)
    expect(result.content).toContain("created pane")
    expect(calls.find((argv) => argv[0] === "split-window")).toContain("%10")
  })

  test("tmux_context notes a directory-resolved anchor", async () => {
    const { ctx, tools } = fakeCtx({}, async () => {}, TMUX_DIR)
    await registerTools(ctx, tmuxRunner(withPaneList()).runner, EMPTY_ENV)

    const result = await tools.get("tmux_context")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("pane_id=%10")
    expect(result.content).toContain("from session directory")
  })

  test("the pane option beats the directory heuristic", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {}, TMUX_DIR)
    const { runner, calls } = tmuxRunner(withPaneList())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_context")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("plugin `pane` option")
    // The heuristic's pane list (with the anchor format) is skipped when the option pins a pane.
    expect(
      calls.some((argv) => argv[0] === "list-panes" && argv[argv.length - 1] === PANE_LIST_FORMAT),
    ).toBe(false)
  })

  test("falls back to $TMUX_PANE with a note when the directory does not match", async () => {
    const { ctx, tools } = fakeCtx({}, async () => {}, "/nowhere")
    await registerTools(ctx, tmuxRunner(withPaneList("%6\n")).runner, { TMUX_PANE: "%6" } as NodeJS.ProcessEnv)

    const result = await tools.get("tmux_context")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("from $TMUX_PANE")
  })
})

describe("tmux_edit", () => {
  const probeOk = { exec: async () => 0, isDirectory: () => false }
  const probeMissing = { exec: async () => 1, isDirectory: () => true }

  test("opens a file in a right-hand focused pane with the resolved editor", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "vim" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV, probeOk)

    const result = await tools.get("tmux_edit")!.execute({ path: "/tmp/f.txt" }, TEST_CONTEXT)
    expect(result.content).toContain("opened /tmp/f.txt with vim")
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
      "sh",
      "-c",
      "exec vim '/tmp/f.txt'",
    ])
  })

  test("placement left uses -h -b and focus false adds -d", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "vim" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV, probeOk)

    await tools.get("tmux_edit")!.execute({ path: "/tmp/f.txt", placement: "left", focus: false }, TEST_CONTEXT)
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
      "-b",
      "sh",
      "-c",
      "exec vim '/tmp/f.txt'",
    ])
  })

  test("placement window opens a named window in the agent's session", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "vim" })
    const { runner, calls } = tmuxRunner(anchorExists("@7\n"))
    await registerTools(ctx, runner, EMPTY_ENV, probeOk)

    await tools.get("tmux_edit")!.execute({ path: "/tmp/proj", placement: "window" }, TEST_CONTEXT)
    expect(calls.find(isSessionProbe)).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{session_id}:"])
    expect(calls.find((argv) => argv[0] === "new-window")).toEqual([
      "new-window",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
      "-n",
      "proj",
      "sh",
      "-c",
      "exec vim '/tmp/proj'",
    ])
  })

  test("a directory uses NERDTree when the probe found it", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "vim" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV, { exec: async () => 0, isDirectory: () => true })

    const result = await tools.get("tmux_edit")!.execute({ path: "/tmp/proj" }, TEST_CONTEXT)
    expect(result.content).toContain("NERDTree")
    expect(calls.find((argv) => argv[0] === "split-window")).toContain("exec vim -c 'NERDTree /tmp/proj'")
  })

  test("a directory opens plainly when NERDTree is absent", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "vim" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV, probeMissing)

    const result = await tools.get("tmux_edit")!.execute({ path: "/tmp/proj" }, TEST_CONTEXT)
    expect(result.content).not.toContain("NERDTree")
    expect(calls.find((argv) => argv[0] === "split-window")).toContain("exec vim '/tmp/proj'")
  })

  test("nano on a directory is reported and nothing opens", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", editor: "nano" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV, { exec: async () => 0, isDirectory: () => true })

    const result = await tools.get("tmux_edit")!.execute({ path: "/tmp/proj" }, TEST_CONTEXT)
    expect(result.content).toContain("folder")
    // Only the existence probe ran.
    expect(calls.length).toBe(1)
  })

  test("no editor reports the three ways to fix it", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV, probeOk)

    const result = await tools.get("tmux_edit")!.execute({ path: "/tmp/f.txt" }, TEST_CONTEXT)
    expect(result.content).toContain("editor")
    expect(result.content).toContain("$EDITOR")
    expect(calls.some((argv) => argv[0] === "split-window")).toBe(false)
  })

  test("the editor is gated by a namespaced resource, not the editor command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6", editor: "vim" })
    await registerTools(ctx, tmuxRunner(anchorExists("%42\n")).runner, EMPTY_ENV, probeOk)

    await tools.get("tmux_edit")!.execute({ path: "/tmp/f.txt" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["tmux_edit /tmp/f.txt"])
    expect(assertCalls[0]!.save).toEqual(["tmux_edit /tmp/f.txt"])
  })
})

describe("tmux_exec", () => {
  test("runs in an existing pane and returns the output", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv) ? ok(`${targetOf(argv)}\n`) : argv[0] === "capture-pane" ? ok("hello\n") : ok(""),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_exec")!.execute({ command: "echo hello", target: "%4" }, TEST_CONTEXT)
    expect(result.content).toBe("hello")
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["echo hello"])
    expect(assertCalls[0]!.save).toEqual(["echo hello"])
    const sends = calls.filter((argv) => argv[0] === "send-keys")
    expect(sends[0]).toEqual(["send-keys", "-t", "%4", "-l", "--", "echo hello"])
    expect(sends[1]).toEqual(["send-keys", "-t", "%4", "Enter"])
    expect(calls.find((argv) => argv[0] === "capture-pane")).toEqual(["capture-pane", "-p", "-t", "%4"])
  })

  test("refuses the anchor pane, omitted or explicit", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const omitted = await tools.get("tmux_exec")!.execute({ command: "ls" }, TEST_CONTEXT)
    expect(omitted.content).toMatch(/refus/i)
    expect(omitted.content).toContain("another pane")
    const explicit = await tools.get("tmux_exec")!.execute({ command: "ls", target: "%6" }, TEST_CONTEXT)
    expect(explicit.content).toMatch(/refus/i)
    expect(calls.some((argv) => argv[0] === "send-keys")).toBe(false)
  })

  test("creates a pane and runs there", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv)
        ? ok("%6\n")
        : argv[0] === "split-window"
          ? ok("%42\n")
          : argv[0] === "capture-pane"
            ? ok("out\n")
            : ok(""),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_exec")!.execute({ command: "echo hi", new: "pane" }, TEST_CONTEXT)
    expect(result.content).toBe("out")
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-v",
    ])
    const sends = calls.filter((argv) => argv[0] === "send-keys")
    expect(sends[0]).toEqual(["send-keys", "-t", "%42", "-l", "--", "echo hi"])
    expect(calls.find((argv) => argv[0] === "capture-pane")).toEqual(["capture-pane", "-p", "-t", "%42"])
  })

  test("creates a window and runs there", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv)
        ? ok("%6\n")
        : isSessionProbe(argv)
          ? ok("$3:\n")
          : argv[0] === "new-window"
            ? ok("@7\n")
            : argv[0] === "capture-pane"
              ? ok("winout\n")
              : ok(""),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_exec")!.execute({ command: "echo hi", new: "window" }, TEST_CONTEXT)
    expect(result.content).toBe("winout")
    expect(calls.find((argv) => argv[0] === "new-window")).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "-a",
    ])
    const sends = calls.filter((argv) => argv[0] === "send-keys")
    expect(sends[0]).toEqual(["send-keys", "-t", "@7", "-l", "--", "echo hi"])
  })

  test("honours focus and place for a new pane", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv) ? ok("%6\n") : argv[0] === "split-window" ? ok("%42\n") : ok("out\n"),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_exec")!.execute(
      { command: "ls", new: "pane", place: "right", focus: true },
      TEST_CONTEXT,
    )
    expect(calls.find((argv) => argv[0] === "split-window")).toEqual([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "%6",
      "-h",
    ])
  })

  test("rejects a place that does not fit the kind", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    const result = await tools.get("tmux_exec")!.execute({ command: "ls", new: "pane", place: "after" }, TEST_CONTEXT)
    expect(result.content).toContain("place")
  })

  test("needs a target when it is not creating one", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    const result = await tools.get("tmux_exec")!.execute({ command: "ls" }, TEST_CONTEXT)
    expect(result.content).toContain("no tmux target")
  })

  test("requires a command", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)
    const result = await tools.get("tmux_exec")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("command is required")
  })
})

describe("permission gate", () => {
  test("tmux_send asserts the shell action with the text as the resource", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_send")!.execute({ text: "rm -rf /", target: "%4" }, TEST_CONTEXT)

    expect(assertCalls.length).toBe(1)
    const call = assertCalls[0]!
    expect(call.action).toBe("shell")
    expect(call.resources).toEqual(["rm -rf /"])
    expect(call.save).toEqual(["rm -rf /"])
    expect(call.sessionID).toBe("ses_test")
    expect(call.agent).toBe("build")
    expect(call.source).toEqual({ type: "tool", messageID: "msg_x", id: "call_x" })
  })

  test("tmux_new skips the gate without a command and gates a raw command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6", shell: "bash" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new")!.execute({ kind: "pane" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)

    await tools.get("tmux_new")!.execute({ kind: "pane", command: "ls | wc -l" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    // The resource is the raw command, not the shell-wrapped form.
    expect(assertCalls[0]!.resources).toEqual(["ls | wc -l"])
  })

  test("tmux_new gates a window command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new")!.execute({ kind: "window", command: "echo hi" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["echo hi"])
  })

  test("tmux_kill never asserts: it runs no shell command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_kill")!.execute({ kind: "pane", target: "%4" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)
  })

  test("a rejecting assert propagates instead of returning content", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("permission denied by user")
    })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await expect(tools.get("tmux_send")!.execute({ text: "x", target: "%4" }, TEST_CONTEXT)).rejects.toThrow(
      "permission denied",
    )
  })

  test("a rejection stops the command from ever running", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("nope")
    })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    await expect(tools.get("tmux_new")!.execute({ kind: "pane", command: "ls" }, TEST_CONTEXT)).rejects.toThrow("nope")
    // The command never reaches tmux: no split-window call.
    expect(calls.some((argv) => argv[0] === "split-window")).toBe(false)
  })
})

describe("stale target detection", () => {
  const stale = (stdout = "%9\n") => (argv: string[]) => (isProbe(argv) ? bad("can't find pane") : ok(stdout))

  for (const [name, args] of [
    ["tmux_send", { text: "hi" }],
    ["tmux_name", { kind: "pane", name: "n" }],
    ["tmux_new", { kind: "pane" }],
    ["tmux_new", { kind: "window" }],
    ["tmux_kill", { kind: "pane" }],
    ["tmux_capture", {}],
    ["tmux_edit", { path: "/tmp/f" }],
    ["tmux_exec", { command: "hi" }],
  ] as const) {
    test(`${name} reports a stale target instead of acting`, async () => {
      const { ctx, tools } = fakeCtx({ pane: "%6" })
      const { runner, calls } = tmuxRunner(stale())
      await registerTools(ctx, runner, EMPTY_ENV)

      const result = await tools.get(name)!.execute(args, TEST_CONTEXT)
      expect(result.content).toContain("does not exist")
      expect(result.content).toContain("%6")
      // Only the existence probe ran.
      expect(calls.length).toBe(1)
      expect(calls[0]).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{pane_id}"])
    })
  }

  test("tmux_context degrades to the pane list when the anchor is stale", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(stale("sess:0.1 pane_id=%2 title=y cmd=zsh\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_context")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("pane_id=%2")
    expect(result.content).toMatch(/anchor/i)
    // The agent-pane display-message (context format) never runs; only the probe
    // and the pane list do.
    expect(
      calls.some((argv) => argv[0] === "display-message" && argv[argv.length - 1] === CONTEXT_FORMAT),
    ).toBe(false)
    expect(calls.some((argv) => argv[0] === "list-panes")).toBe(true)
  })
})
