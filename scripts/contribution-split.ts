// Regenerates the "Contribution split" table rows in README.md.
//
// The human/AI bar is two gauges meeting at a fixed divider, ten cells per
// side, filled outward from the divider with a full block and left in a light
// shade otherwise, one cell per ten points (floor(percent / 10)).
//
// Renderers collapse runs of ordinary spaces (CSS `white-space: normal`), so
// the padding is non-breaking space (U+00A0), which does not collapse. The
// whole bar cell is wrapped in a code span so a monospace font keeps every
// glyph one cell wide. Neither percentage value is changed here; only layout.
//
// Usage: bun scripts/contribution-split.ts [README.md]  (rewrites the rows)
//        bun scripts/contribution-split.ts --print       (rows to stdout)

const NB = "\u00A0";
const FULL = "\u2588"; // █
const LIGHT = "\u2591"; // ░
const DIVIDER = "\u2502"; // │

const HUMAN_WIDTH = 4;
const AI_WIDTH = 4;
const GAP = 2;

/** Left-align a value in `width` cells, padding the tail with NBSP. */
const padEnd = (value: string, width: number): string =>
  value + NB.repeat(Math.max(0, width - [...value].length));

/** Right-align a value in `width` cells, padding the head with NBSP. */
const padStart = (value: string, width: number): string =>
  NB.repeat(Math.max(0, width - [...value].length)) + value;

/** Two gauges on one hundred-point scale, meeting at the divider. */
const bar = (human: number, ai: number): string => {
  const h = Math.floor(human / 10);
  const a = Math.floor(ai / 10);
  return (
    LIGHT.repeat(10 - h) + FULL.repeat(h) + DIVIDER + FULL.repeat(a) + LIGHT.repeat(10 - a)
  );
};

/** One cell: right-aligned human field, bar, left-aligned AI field. */
const cell = (human: number, ai: number): string =>
  "`" +
  padStart(`${human}%`, HUMAN_WIDTH) +
  NB.repeat(GAP) +
  bar(human, ai) +
  NB.repeat(GAP) +
  padEnd(`${ai}%`, AI_WIDTH) +
  "`";

const ROWS: Array<[label: string, human: number, ai: number]> = [
  ["Architecture", 75, 25],
  ["Requirements", 90, 10],
  ["Implementation (human oversight)", 0, 100],
  ["Testing", 0, 100],
  ["Review", 50, 50],
  ["Documentation", 10, 90],
];

const rowLine = (label: string, human: number, ai: number): string =>
  `| ${label} | ${cell(human, ai)} |`;

const renderRows = (): string[] => ROWS.map(([label, h, a]) => rowLine(label, h, a));

const arg = process.argv[2];
if (arg === "--print" || arg === undefined) {
  console.log(renderRows().join("\n"));
} else {
  const file = Bun.file(arg);
  const lines = (await file.text()).split("\n");
  const byLabel = new Map(ROWS.map(([label, h, a]) => [label, rowLine(label, h, a)]));
  const found = new Set<string>();
  let changed = 0;
  const out = lines.map((line) => {
    const match = /^\| ([^|]+?) \|/.exec(line);
    const label = match?.[1];
    const replacement = label ? byLabel.get(label) : undefined;
    if (replacement === undefined) return line;
    found.add(label!);
    if (replacement === line) return line;
    changed++;
    return replacement;
  });
  const missing = ROWS.map(([label]) => label).filter((label) => !found.has(label));
  if (missing.length > 0) {
    console.error(`no row found for: ${missing.join(", ")}`);
    process.exit(1);
  }
  await Bun.write(arg, out.join("\n"));
  console.error(`rewrote ${changed} rows in ${arg}`);
}
