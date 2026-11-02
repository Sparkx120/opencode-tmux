import { describe, expect, test } from "bun:test"
import { isAbsolute } from "node:path"
import { buildSkillRegistration, SKILL_DIRS, skillFilePath, skillFilePaths } from "../src/skills.js"

const SAMPLE = [
  "---",
  "name: Tmux",
  "description: Interact with tmux panes and windows",
  "---",
  "# Tmux",
  "",
  "Body text.",
].join("\n")

describe("buildSkillRegistration", () => {
  test("derives the id from the containing directory", () => {
    const skill = buildSkillRegistration(SAMPLE, "/repo/skills/tmux/SKILL.md")
    expect(String(skill.id)).toBe("tmux")
  })

  test("takes name and description from the frontmatter", () => {
    const skill = buildSkillRegistration(SAMPLE, "/repo/skills/tmux/SKILL.md")
    expect(String(skill.name)).toBe("Tmux")
    expect(skill.description).toBe("Interact with tmux panes and windows")
  })

  test("keeps the body without the frontmatter", () => {
    const skill = buildSkillRegistration(SAMPLE, "/repo/skills/tmux/SKILL.md")
    expect(skill.content).toBe("# Tmux\n\nBody text.")
  })

  test("sets the absolute path to SKILL.md", () => {
    const skill = buildSkillRegistration(SAMPLE, "/repo/skills/tmux/SKILL.md")
    expect(String(skill.path)).toBe("/repo/skills/tmux/SKILL.md")
  })
})

describe("skillFilePath", () => {
  test("points at the given skill's SKILL.md and is absolute", () => {
    expect(isAbsolute(skillFilePath("tmux"))).toBe(true)
    expect(skillFilePath("tmux").endsWith("/skills/tmux/SKILL.md")).toBe(true)
    expect(skillFilePath("tmux-editor").endsWith("/skills/tmux-editor/SKILL.md")).toBe(true)
  })
})

describe("skillFilePaths", () => {
  test("lists both shipped skills, in order", () => {
    expect(SKILL_DIRS).toEqual(["tmux", "tmux-editor"])
    const paths = skillFilePaths()
    expect(paths).toHaveLength(2)
    expect(paths[0]!.endsWith("/skills/tmux/SKILL.md")).toBe(true)
    expect(paths[1]!.endsWith("/skills/tmux-editor/SKILL.md")).toBe(true)
  })
})
