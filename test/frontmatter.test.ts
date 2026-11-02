import { describe, expect, test } from "bun:test"
import { parseFrontmatter } from "../src/frontmatter.js"

describe("parseFrontmatter", () => {
  test("parses name and description and strips the block", () => {
    const src = ["---", "name: Tmux", "description: Use tmux well", "---", "# Body", "", "text"].join("\n")
    const { data, content } = parseFrontmatter(src)
    expect(data.name).toBe("Tmux")
    expect(data.description).toBe("Use tmux well")
    expect(content).toBe("# Body\n\ntext")
  })

  test("returns empty data and the whole text when there is no frontmatter", () => {
    const src = "# Body\n\nno frontmatter here"
    const { data, content } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(content).toBe(src)
  })

  test("ignores unknown keys and nested blocks", () => {
    const src = [
      "---",
      "name: Tmux",
      "metadata:",
      "  nested: true",
      "  deeper:",
      "    value: 1",
      "allowed-tools: Bash",
      "description: desc here",
      "---",
      "body",
    ].join("\n")
    const { data, content } = parseFrontmatter(src)
    expect(data).toEqual({ name: "Tmux", description: "desc here" })
    expect(content).toBe("body")
  })

  test("handles CRLF line endings", () => {
    const src = "---\r\nname: Tmux\r\ndescription: crlf desc\r\n---\r\nbody line\r\nsecond"
    const { data, content } = parseFrontmatter(src)
    expect(data.name).toBe("Tmux")
    expect(data.description).toBe("crlf desc")
    expect(content).toBe("body line\r\nsecond")
  })

  test("strips surrounding quotes from values", () => {
    const src = ["---", 'name: "Tmux"', "description: 'quoted desc'", "---", "body"].join("\n")
    const { data } = parseFrontmatter(src)
    expect(data.name).toBe("Tmux")
    expect(data.description).toBe("quoted desc")
  })

  test("handles a file that is only frontmatter", () => {
    const src = ["---", "name: Tmux", "---"].join("\n")
    const { data, content } = parseFrontmatter(src)
    expect(data.name).toBe("Tmux")
    expect(content).toBe("")
  })

  test("preserves body lines that contain colons", () => {
    const src = ["---", "name: Tmux", "---", "key: value in the body"].join("\n")
    const { content } = parseFrontmatter(src)
    expect(content).toBe("key: value in the body")
  })
})
