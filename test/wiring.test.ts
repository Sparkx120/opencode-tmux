import { describe, expect, test } from "bun:test"
import plugin from "../index.js"

function fakeCtx() {
  const toolNames = new Set<string>()
  const skillIds = new Set<string>()
  const ctx = {
    // nano short-circuits the NERDTree probe, keeping this test hermetic.
    options: { editor: "nano" },
    tool: {
      transform: async (cb: (editor: unknown) => void) => {
        cb({ add: (tool: { name: string }) => toolNames.add(tool.name) })
        return { dispose: async () => {} }
      },
    },
    skill: {
      transform: async (cb: (editor: unknown) => void) => {
        cb({ add: (skill: { id: string }) => skillIds.add(String(skill.id)) })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx, toolNames, skillIds }
}

describe("plugin entry", () => {
  test("has the id tmux", () => {
    expect(plugin.id).toBe("tmux")
  })

  test("setup registers the tools and the skill", async () => {
    const { ctx, toolNames, skillIds } = fakeCtx()
    await plugin.setup(ctx as never)
    expect(toolNames.has("tmux_context")).toBe(true)
    expect(toolNames.size).toBe(7)
    expect(skillIds.has("tmux")).toBe(true)
  })
})
