// Regenerates the "Contribution split" table rows in README.md.
//
// The human/AI bar is two gauges meeting at a fixed divider, ten cells per
// side, filled outward from the divider with a full block and left in a light
// shade otherwise, one cell per ten points (floor(percent / 10)).
//
// The padding is non-breaking space (U+00A0) and each cell is wrapped in a code
// span. The code span supplies the monospace face. The non-breaking space is
// what survives the renderer: a CommonMark code span that begins and ends with a
// space loses one space from each end, and space collapsing in a rendered table
// has the same effect. U+00A0 is neither a CommonMark space character nor a
// collapsible space. Neither percentage value is changed here; only layout.
//
// Usage: bun scripts/contribution-split.ts [README.md]  (rewrites the rows)
//        bun scripts/contribution-split.ts --print       (rows to stdout)

export const NB = "\u00A0"
const FULL = "\u2588" // █
const LIGHT = "\u2591" // ░
export const DIVIDER = "\u2502" // │

export const HUMAN_WIDTH = 4
export const AI_WIDTH = 4
const GAP = 2

// Left-align a value in `width` cells, padding the tail with non-breaking space.
const padEnd = (value: string, width: number): string =>
  value + NB.repeat(Math.max(0, width - [...value].length))

// Right-align a value in `width` cells, padding the head with non-breaking space.
const padStart = (value: string, width: number): string =>
  NB.repeat(Math.max(0, width - [...value].length)) + value

// Two gauges on one hundred-point scale, meeting at the divider.
export const bar = (human: number, ai: number): string => {
  const h = Math.floor(human / 10)
  const a = Math.floor(ai / 10)
  return LIGHT.repeat(10 - h) + FULL.repeat(h) + DIVIDER + FULL.repeat(a) + LIGHT.repeat(10 - a)
}

// One cell: right-aligned human field, bar, left-aligned AI field.
export const cell = (human: number, ai: number): string =>
  "`" +
  padStart(`${human}%`, HUMAN_WIDTH) +
  NB.repeat(GAP) +
  bar(human, ai) +
  NB.repeat(GAP) +
  padEnd(`${ai}%`, AI_WIDTH) +
  "`"

export type SplitRow = [label: string, human: number, ai: number]

export const ROWS: SplitRow[] = [
  ["Architecture", 75, 25],
  ["Requirements", 90, 10],
  ["Implementation (human oversight)", 0, 100],
  ["Testing", 0, 100],
  ["Review", 50, 50],
  ["Documentation", 10, 90],
]

export const rowLine = (label: string, human: number, ai: number): string =>
  `| ${label} | ${cell(human, ai)} |`

export const renderRows = (): string[] => ROWS.map(([label, h, a]) => rowLine(label, h, a))

export interface RewriteResult {
  text: string
  changed: number
  missing: string[]
}

// Replaces each split row in `text` with its generated form. Rows are matched by
// their first cell. A label with no matching row is reported in `missing` rather
// than failing, so the caller decides what a missing row means.
export const rewrite = (text: string): RewriteResult => {
  const byLabel = new Map(ROWS.map(([label, h, a]) => [label, rowLine(label, h, a)]))
  const found = new Set<string>()
  let changed = 0
  const lines = text.split("\n").map((line) => {
    const match = /^\| ([^|]+?) \|/.exec(line)
    const label = match?.[1]
    const replacement = label ? byLabel.get(label) : undefined
    if (replacement === undefined) return line
    found.add(label as string)
    if (replacement === line) return line
    changed++
    return replacement
  })
  const missing = ROWS.map(([label]) => label).filter((label) => !found.has(label))
  return { text: lines.join("\n"), changed, missing }
}

const printRows = (): void => {
  console.log(renderRows().join("\n"))
}

const rewriteFile = async (path: string): Promise<void> => {
  const result = rewrite(await Bun.file(path).text())
  if (result.missing.length > 0) {
    console.error(`no row found for: ${result.missing.join(", ")}`)
    process.exit(1)
  }
  await Bun.write(path, result.text)
  console.error(`rewrote ${result.changed} rows in ${path}`)
}

if (import.meta.main) {
  const arg = process.argv[2]
  if (arg === undefined || arg === "--print") {
    printRows()
  } else {
    await rewriteFile(arg)
  }
}
