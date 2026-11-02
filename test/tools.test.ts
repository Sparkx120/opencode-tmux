import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerTools } from "../src/tools.js"
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

function recordingRunner(stdout = "%9\n"): { runner: Runner; calls: string[][] } {
  const calls: string[][] = []
  const runner: Runner = async (argv) => {
    calls.push(argv)
    return ok(stdout)
  }
  return { runner, calls }
}

const NAMES = ["tmux_context", "tmux_name", "tmux_new_pane", "tmux_new_window", "tmux_send", "tmux_capture"]

describe("registerTools", () => {
  test("registers exactly the six tmux tools", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)
    expect([...tools.keys()].sort()).toEqual([...NAMES].sort())
  })

  test("every description carries the skill guidance", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)
    for (const name of NAMES) {
      const t = tools.get(name)!
      expect(t.description).toContain("tmux")
      expect(t.description.toLowerCase()).toContain("skill")
    }
  })

  test("input schemas are objects with additionalProperties false", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)
    for (const name of NAMES) {
      const schema = tools.get(name)!.input as { type: string; additionalProperties: boolean }
      expect(schema.type).toBe("object")
      expect(schema.additionalProperties).toBe(false)
    }
  })

  test("tools with no target respond with a helpful message instead of running tmux", async () => {
    const { ctx, tools } = fakeCtx()
    const { runner, calls } = recordingRunner()
    await registerTools(ctx, runner, EMPTY_ENV)

    const send = await tools.get("tmux_send")!.execute({ text: "hi" }, {})
    expect(send.content).toContain("no tmux target")
    const capture = await tools.get("tmux_capture")!.execute({}, {})
    expect(capture.content).toContain("no tmux target")
    expect(calls.length).toBe(0)
  })

  test("target resolves from the plugin option when the arg is omitted", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = recordingRunner("pane %6\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_send")!.execute({ text: "ls" }, {})
    expect(result.content).toContain("sent")
    expect(calls[0]).toEqual(["send-keys", "-t", "%6", "-l", "ls"])
    expect(calls[1]).toEqual(["send-keys", "-t", "%6", "Enter"])
  })

  test("tmux_new_pane returns the new pane id and names it", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = recordingRunner("%42\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new_pane")!.execute({ name: "worker" }, {})
    expect(result.content).toContain("%42")
    expect(calls[0]).toEqual(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", "%6", "-v"])
    expect(calls[1]).toEqual(["select-pane", "-t", "%42", "-T", "worker"])
  })

  test("tmux_new_pane runs a command through the configured shell", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6", shell: "bash" })
    const { runner, calls } = recordingRunner("%42\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({ command: "ls | wc -l" }, {})
    expect(calls[0]).toEqual([
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

  test("tmux_new_window defaults the command shell to sh and targets the agent session", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner, calls } = recordingRunner("@7\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({ command: "echo hi" }, {})
    expect(calls[0]).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "%6",
      "sh",
      "-c",
      "echo hi",
    ])
  })

  test("tmux_new_window reports a missing target instead of running tmux", async () => {
    const { ctx, tools } = fakeCtx()
    const { runner, calls } = recordingRunner()
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_new_window")!.execute({}, {})
    expect(result.content).toContain("no tmux target")
    expect(calls.length).toBe(0)
  })

  test("tmux_send no longer requires a target in its schema", async () => {
    const { ctx, tools } = fakeCtx()
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)
    const schema = tools.get("tmux_send")!.input as { required: string[] }
    expect(schema.required).toContain("text")
    expect(schema.required).not.toContain("target")
  })

  test("tmux_capture returns captured text", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner } = recordingRunner("hello world\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_capture")!.execute({}, {})
    expect(result.content).toContain("hello world")
  })

  test("tmux_context reports the agent pane and the pane list", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const { runner } = recordingRunner("sess:0.1 pane_id=%6 title=x cmd=zsh\n")
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_context")!.execute({}, {})
    expect(result.content).toContain("pane_id=%6")
  })

  test("a failed tmux command becomes a text message, not a throw", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" })
    const runner: Runner = async () => ({ stdout: "", stderr: "can't find pane", code: 1, message: "can't find pane" })
    await registerTools(ctx, runner, EMPTY_ENV)

    const result = await tools.get("tmux_capture")!.execute({}, {})
    expect(result.content).toContain("can't find pane")
  })
})

describe("permission gate", () => {
  test("tmux_send asserts the shell action with the text as the resource", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

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
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({}, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)
  })

  test("tmux_new_pane gates the shell-wrapped command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6", shell: "bash" })
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

    await tools.get("tmux_new_pane")!.execute({ command: "ls | wc -l" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["bash -c ls | wc -l"])
  })

  test("tmux_new_window gates the shell-wrapped command", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({ command: "echo hi" }, TEST_CONTEXT)
    expect(assertCalls.length).toBe(1)
    expect(assertCalls[0]!.action).toBe("shell")
    expect(assertCalls[0]!.resources).toEqual(["sh -c echo hi"])
  })

  test("tmux_new_window skips the gate when no command is given", async () => {
    const { ctx, tools, assertCalls } = fakeCtx({ pane: "%6" })
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

    await tools.get("tmux_new_window")!.execute({}, TEST_CONTEXT)
    expect(assertCalls.length).toBe(0)
  })

  test("a rejecting assert propagates instead of returning content", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("permission denied by user")
    })
    await registerTools(ctx, recordingRunner().runner, EMPTY_ENV)

    await expect(tools.get("tmux_send")!.execute({ text: "x" }, TEST_CONTEXT)).rejects.toThrow("permission denied")
  })

  test("a rejection stops the command from ever running", async () => {
    const { ctx, tools } = fakeCtx({ pane: "%6" }, async () => {
      throw new Error("nope")
    })
    const { runner, calls } = recordingRunner()
    await registerTools(ctx, runner, EMPTY_ENV)

    await expect(tools.get("tmux_new_pane")!.execute({ command: "ls" }, TEST_CONTEXT)).rejects.toThrow("nope")
    expect(calls.length).toBe(0)
  })
})
