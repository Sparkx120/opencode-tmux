// Dependency-free SKILL.md frontmatter parser. Only `name` and `description`
// are extracted; any other key, nested block, or malformed line is ignored so
// a richer skill file still loads.

export interface FrontmatterData {
  name?: string
  description?: string
}

export interface Frontmatter {
  data: FrontmatterData
  content: string
}

// Leading `---\n ... \n---` block, tolerating CRLF and trailing spaces on the
// delimiter lines. The trailing newline after the closing delimiter is part of
// the match so the body starts on its own line.
const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(text: string): Frontmatter {
  const match = BLOCK.exec(text)
  if (!match) return { data: {}, content: text }

  const data: FrontmatterData = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    // Indented lines belong to a nested block (a list or map value); skip them.
    if (/^\s/.test(line)) continue
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!
    let value = kv[2]!.trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    if (key === "name") data.name = value
    else if (key === "description") data.description = value
  }

  return { data, content: text.slice(match[0].length) }
}
