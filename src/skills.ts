// Skill loader. Each skill body lives in skills/<dir>/SKILL.md; this module
// reads them, parses the frontmatter, and registers them with the host. The
// pure buildSkillRegistration split keeps the object shape testable without disk.

import { readFile } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { parseFrontmatter } from "./frontmatter.js"

// Every skill the plugin ships, by directory name under skills/.
export const SKILL_DIRS = ["tmux", "tmux-editor"] as const

// src/skills.ts -> repo root -> skills/<dir>/SKILL.md
export function skillFilePath(dir: string): string {
  return fileURLToPath(new URL(`../skills/${dir}/SKILL.md`, import.meta.url))
}

export function skillFilePaths(): string[] {
  return SKILL_DIRS.map((dir) => skillFilePath(dir))
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
  const skills = await Promise.all(
    SKILL_DIRS.map(async (dir) => {
      const path = skillFilePath(dir)
      return buildSkillRegistration(await readFile(path, "utf8"), path)
    }),
  )
  return ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill)
  })
}
