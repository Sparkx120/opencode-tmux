import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerTools } from "../src/tools.js"
import { CONTEXT_FORMAT } from "../src/tmux.js"
import type { RunResult, Runner } from "../src/tmux.js"
const EMPTY_ENV = {} as NodeJS.ProcessEnv

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
): { ctx: Plugin.Context; tools: Map<string, Captured>; assertCalls: AssertCall[] } {
  const tools = new Map<string, Captured>()
  const assertCalls: AssertCall[] = []
  const ctx = {
    options,
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

// The stale-anchor probe is the display-message that asks for #{pane_id}; the
// session probe asks for #{session_id}.
const isProbe = (argv: string[]) => argv[0] === "display-message" && argv[argv.length - 1] === "#{pane_id}"
const isSessionProbe = (argv: string[]) => argv[0] === "display-message" && argv[argv.length - 1] === "#{session_id}:"

function tmuxRunner(respond: (argv: string[]) => RunResult): { runner: Runner; calls: string[][] } {
  const calls: string[][] = []
  const runner: Runner = async (argv) => {
    calls.push(argv)
    return respond(argv)
  }
  return { runner, calls }
}

// Default responder: the anchor exists, its session resolves, every other
// command succeeds.
const anchorExists = (stdout = "%9\n") => (argv: string[]) =>
  isProbe(argv) ? ok("%6\n") : isSessionProbe(argv) ? ok("$3:\n") : ok(stdout)

const NAMES = ["tmux_context", "tmux_name", "tmux_new_pane", "tmux_new_window", "tmux_send", "tmux_capture"]

describe("registerTools", () => {
  test("registers exactly the six tmux tools", async () => {
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
    expect(calls.length).toBe(0)
  })

  test("target resolves from the plugin option when the arg is omitted", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_send")!.execute({ text: "ls" }, TEST_CONTEXT)
    expect(result.content).toContain("sent")
    const sends = calls.filter((argv) => argv[0] === "send-keys")
    expect(sends[0]).toEqual(["send-keys", "-t", "%6", "-l", "--", "ls"])
    expect(sends[1]).toEqual(["send-keys", "-t", "%6", "Enter"])
  })

  test("tmux_new_pane returns the new pane id and names it", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new_pane")!.execute({ name: "worker" }, TEST_CONTEXT)
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

  test("tmux_new_pane runs a command through the configured shell", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", shell: "bash" })
    const { runner, calls } = tmuxRunner(anchorExists("%42\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({ command: "ls | wc -l" }, TEST_CONTEXT)
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

  test("tmux_new_window resolves the session and runs the command through sh", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner(anchorExists("@7\n"))
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({ command: "echo hi" }, TEST_CONTEXT)
    expect(calls.find(isSessionProbe)).toEqual(["display-message", "-p", "-t", "%6", "-F", "#{session_id}:"])
    expect(calls.find((argv) => argv[0] === "new-window")).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "$3:",
      "sh",
      "-c",
      "echo hi",
    ])
  })

  test("tmux_new_window reports when the session cannot be resolved", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = tmuxRunner((argv) =>
      isProbe(argv) ? ok("%6\n") : isSessionProbe(argv) ? bad("no session") : ok("@7\n"),
    )
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new_window")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("does not exist")
    expect(calls.some((argv) => argv[0] === "new-window")).toBe(false)
  })

  test("tmux_new_window reports a missing target instead of running tmux", async () => {
    const { ctx, tools } = fakeCtx()
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new_window")!.execute({}, TEST_CONTEXT)
    expect(result.content).toContain("no tmux target")
    expect(calls.length).toBe(0)
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

describe("permission gate", () => {
  test("tmux_send asserts the shell action with the text as the resource", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_send")!.execute({ text: "rm -rf /" }, TEST_CONTEXT)

    expect(assertCalls.length).toBe(1)
    const call = assertCalls[0]!
    expect(call.action).toBe("shell")
    expect(call.resources).toEqual(["rm -rf /"])
    expect(call.save).toEqual(["rm -rf /"])
    expect(call.sessionID).toBe("ses_test")
    expect(call.agent).toBe("build")
    expect(call.source).toEqual({ type: "tool", messageID: "msg_x", id: "call_x" })
  })

  test("tmux_new_pane skips the gate when no command is given", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({}, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)
  })

  test("tmux_new_pane gates the raw command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6", shell: "bash" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({ command: "ls | wc -l" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    // The resource is the raw command, not the shell-wrapped form, so user
    // rules like `ls *` match.
    expect(assertCalls[0]!.resources).toEqual(["ls | wc -l"])
  })

  test("tmux_new_window gates the raw command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({ command: "echo hi" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["echo hi"])
  })

  test("tmux_new_window skips the gate when no command is given", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({}, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)
  })

  test("a rejecting assert propagates instead of returning content", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("permission denied by user")
    })
    await registerTools(ctx, tmuxRunner(anchorExists()).runner, EMPTY_ENV)

    await expect(tools.get("tmux_send")!.execute({ text: "x" }, TEST_CONTEXT)).rejects.toThrow("permission denied")
  })

  test("a rejection stops the command from ever running", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("nope")
    })
    const { runner, calls } = tmuxRunner(anchorExists())
    await registerTools(ctx, runner, EMPTY_ENV)

    await expect(tools.get("tmux_new_pane")!.execute({ command: "ls" }, TEST_CONTEXT)).rejects.toThrow("nope")
    // The command never reaches tmux: no split-window call.
    expect(calls.some((argv) => argv[0] === "split-window")).toBe(false)
  })
})

describe("stale target detection", () => {
  const stale = (stdout = "%9\n") => (argv: string[]) => (isProbe(argv) ? bad("can't find pane") : ok(stdout))

  for (const [name, args] of [
    ["tmux_send", { text: "hi" }],
    ["tmux_name", { kind: "pane", name: "n" }],
    ["tmux_new_pane", {}],
    ["tmux_new_window", {}],
    ["tmux_capture", {}],
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
