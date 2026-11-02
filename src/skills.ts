// Skill loader. The skill body lives in skills/tmux/SKILL.md; this module
// reads it, parses the frontmatter, and registers it with the host. The pure
// buildSkillRegistration split keeps the object shape testable without disk.

import { readFile } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { parseFrontmatter } from "./frontmatter.js"

// src/skills.ts -> repo root -> skills/tmux/SKILL.md
export function skillFilePath(): string {
  return fileURLToPath(new URL("../skills/tmux/SKILL.md", import.meta.url))
}

export function buildSkillRegistration(fileContents: string, absolutePath: string): Skill.Info {
  const { data, content } = parseFrontmatter(fileContents)
  // The directory name is the skill's stable identity, independent of the
  // display name the frontmatter carries.
  const id = basename(dirname(absolutePath))
  return {
    id: Skill.ID.make(id),
    name: Skill.Name.make(data.name ?? id),
    description: data.description,
    path: Skill.Info.fields.path.make(absolutePath),
    content,
  }
}

export async function registerSkills(ctx: Plugin.Context) {
  const path = skillFilePath()
  const fileContents = await readFile(path, "utf8")
  const skill = buildSkillRegistration(fileContents, path)
  return ctx.skill.transform((editor) => {
    editor.add(skill)
  })
}
