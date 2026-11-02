import { describe, expect, test } from "bun:test"
import { DIVIDER, NB, ROWS, renderRows, rewrite } from "../scripts/contribution-split.js"

// The settled human/AI pairs. The generator must reproduce them exactly.
const EXPECTED: Record<string, [number, number]> = {
  Architecture: [75, 25],
  Requirements: [90, 10],
  "Implementation (human oversight)": [0, 100],
  Testing: [0, 100],
  Review: [50, 50],
  Documentation: [10, 90],
}

// The cell body is what sits between the backticks of the code span.
const cellBody = (line: string): string =>
  line.slice(line.indexOf("`") + 1, line.lastIndexOf("`"))

const label = (line: string): string => /^\| ([^|]+?) \|/.exec(line)?.[1] ?? ""

const percentages = (line: string): number[] =>
  [...cellBody(line).matchAll(/(\d+)%/g)].map((match) => Number(match[1]))

describe("contribution-split", () => {
  test("renders one row per phase", () => {
    expect(renderRows()).toHaveLength(6)
    expect(ROWS.map(([name]) => name)).toEqual(Object.keys(EXPECTED))
  })

  test("keeps the human and AI percentages at their settled values", () => {
    for (const line of renderRows()) {
      expect(percentages(line)).toEqual(EXPECTED[label(line)])
    }
  })

  test("pads with non-breaking space, never an ordinary space", () => {
    for (const line of renderRows()) {
      const body = cellBody(line)
      expect(body.includes("\u0020")).toBe(false)
      expect(body.includes(NB)).toBe(true)
    }
  })

  test("puts the divider at the same code-point offset on every row", () => {
    const offsets = new Set(renderRows().map((line) => cellBody(line).indexOf(DIVIDER)))
    expect(offsets.size).toBe(1)
  })

  test("rewrites exactly the six rows and is idempotent", () => {
    // An ordinary-space table stands in for a hand-padded one.
    const source = [
      "| Work type | Human / AI |",
      "| --- | --- |",
      ...renderRows().map((line) => line.replaceAll(NB, " ")),
    ].join("\n")

    const first = rewrite(source)
    expect(first.changed).toBe(6)
    expect(first.missing).toEqual([])
    expect(first.text).toBe(
      ["| Work type | Human / AI |", "| --- | --- |", ...renderRows()].join("\n"),
    )

    const second = rewrite(first.text)
    expect(second.changed).toBe(0)
    expect(second.text).toBe(first.text)
  })
})
