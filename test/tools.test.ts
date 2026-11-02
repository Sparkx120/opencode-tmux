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

function fakeCtx(options: Record<string, unknown> = {}): { ctx: Plugin.Context; tools: Map<string, Captured> } {
  const tools = new Map<string, Captured>()
  const ctx = {
    options,
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
  return { ctx, tools }
}

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
