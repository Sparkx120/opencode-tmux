# AI contribution disclaimer

The README carries the AI disclosure under `AI Disclosure`, with two subsections,
`Contribution split` and `Models`. Keep both current as the work moves.

## Contribution split

The split is an estimate of how the work was divided, not a measurement, so settle the
percentages with the user rather than setting them alone. There is a row per phase:
architecture, requirements, implementation, testing, review, and documentation.

Each row is one cell holding the human percentage, the bar, and the AI percentage. In the
bar the divider `│` is the axis and sits at a fixed column, so the two sides are separate
gauges on the same hundred-point scale rather than one bar split at a point. Each side is
ten cells wide, one cell per ten points, filled outward from the divider with `█` and left
in `░` otherwise, so a side draws `floor(percent / 10)` cells.

The percentage is right-aligned in a fixed-width field before the bar and left-aligned in a
fixed-width field after it, so each value hugs the divider and neither field moves with the
width of its number.

Two things hold the columns in place when the table renders.

- The padding is non-breaking space (`U+00A0`), not the ordinary space. A CommonMark code
  span that begins and ends with a space loses one space from each end, so a cell padded
  with an ordinary space loses its leading pad and misaligns; space collapsing in a
  rendered table has the same effect. The non-breaking space is neither a CommonMark space
  character nor a collapsible space, so it survives the edge trimming and any collapsing,
  and holds every field at its fixed width. A code-span-only cell padded with ordinary
  spaces still misaligns, because the padding is trimmed or collapsed away.
- The whole bar cell is wrapped in a code span, so a monospace font keeps every glyph,
  including `█`, `░`, and `│`, one cell wide.

The code span supplies the monospace face; the non-breaking space is what survives the
renderer.

Regenerate the rows with `scripts/contribution-split.ts`
(`bun scripts/contribution-split.ts README.md`) rather than adjusting the spacing by hand,
since hand-padding drifts and the divider stops lining up. The script holds the percentage
pairs and rewrites the six rows in place.

## Models

The `Models` list names each model used and the phases it covered, and stays limited to
models that actually ran the work. Ask before recording a model that has not.
