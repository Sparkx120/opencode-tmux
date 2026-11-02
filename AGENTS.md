# AGENTS.md

## What this repo is

An OpenCode v2 plugin that adds a lean set of tmux tools and two skills. It registers
`tmux_context`, `tmux_new`, `tmux_kill`, `tmux_name`, `tmux_send`, `tmux_capture`,
`tmux_exec`, and `tmux_edit`, plus the `tmux` and `tmux-editor` skills. It drives the
`tmux` binary through `execFile`; there is no tmux library and no shell wrapper around the
plugin itself.

## Loading it while you work

The plugin is loaded by path from the `plugins` array in
`~/.config/opencode/opencode.jsonc` (`~/.config/opencode` is a symlink into a separate repository, so a config edit belongs in a commit there). Source changes apply on
reload.

A reload re-imports the entry but keeps the existing module graph. Renaming an export or
moving a module can therefore pair a cached importer with a new module, and the plugin
fails to load with `Export named ... not found`. When that happens the module cache is
stale: restart the service (`opencode service restart`), which interrupts every TUI on it.
Check `~/.local/share/opencode/log/opencode.log` for the load warning either way.

## Source map

- `index.ts` — plugin entry at the repo root: `Plugin.define({ id: "tmux", setup })`,
  registering the tools and then the skills.
- `src/tmux.ts` — the pure argv builders and the runner. `run` shells out and never
  rejects, returning a `message` for a non-zero exit. Builders: `newArgv`, `killArgv`,
  `nameArgv`, `sendKeysArgv`, `captureArgv`, `targetExistsArgv`, `sessionForArgv`,
  `windowForArgv`. Waiting: `settleCapture` for a pane read, `waitForExecOutput` for a
  bracketed command. Sentinel helpers: `execMarker`, `bracketedCommand`,
  `extractExecOutput`.
- `src/anchor.ts` — per-session anchor resolution: `listPanesArgv`, `parsePaneRows`,
  `normalizePath`, `chooseAnchor`.
- `src/editor.ts` — editor resolution and the pane command: `resolveEditor`,
  `isVimFamily`, `isNano`, `NERD_TREE_PROBE_ARGS`, `probeNerdTree`, `shellQuote`,
  `editorInvocation`.
- `src/frontmatter.ts` — dependency-free frontmatter parser for `SKILL.md`.
- `src/skills.ts` — `SKILL_DIRS` and registration of every skill directory.
- `src/tools.ts` — the tool surface, the anchor guards, and the permission asserts. Every
  `execute` returns `{ content }` text and never throws.
- `skills/tmux/SKILL.md`, `skills/tmux-editor/SKILL.md` — the skill bodies.
- `test/` — the `bun test` suite. The builders and pure helpers are driven with plain
  values; the host seams (tools, skills, wiring) run over fake `ctx` objects; the
  integration file drives a real tmux and is opt-in.

The plan for the current feature set lives outside the repo at
`~/.opencode/plan/opencode-tmux-0001-editor-and-tool-merge.md`.

## Invariants

- Tools have explicit, named options. No raw tmux flag passthrough, and no option that
  forwards an unvalidated string into tmux as flags.
- Every tool description ends with guidance to load the `tmux` skill first. The
  `tmux_edit` description and the `tmux-editor` skill both say the editor is opened only
  on an explicit user request.
- Target resolution order: explicit per-call target, then the plugin `pane` option, then
  the directory anchor, then `$TMUX_PANE`. The directory anchor matches the session's
  location directory against a pane's current path, because the `opencode serve` daemon
  is shared and its inherited `$TMUX_PANE` belongs to whichever pane launched it.
- The anchor pane is protected. `tmux_kill` refuses the anchor pane and the window that
  contains it, with no override. `tmux_send` and `tmux_exec` refuse the anchor pane, since
  they would type into the agent's own TUI.
- Everything that would run a command asserts OpenCode's `shell` permission action:
  `tmux_send` and `tmux_new` assert the raw command, `tmux_exec` asserts the raw command
  so per-command rules still govern, and `tmux_edit` asserts the namespaced resource
  `tmux_edit <path>` so one config rule covers it whatever `$EDITOR` resolves to.
- `tmux_exec` brackets its command with a per-call sentinel and waits for the end sentinel
  before slicing the output. Waiting for the capture to stop changing is a bug: a fresh
  pane is momentarily stable before the command runs. When the sentinels cannot be found,
  the raw capture comes back with a note instead of partial output.
- Every tool probes the resolved target for existence before acting, so a stale anchor
  fails with a clear message rather than a raw tmux error.
- The NERDTree probe uses `-N`: plain `-es` starts vi-compatible and does not load
  packages, so NERDTree would always look absent.

## Run and test

- `bun install` — dependencies (`@opencode/plugin` for types and runtime).
- `bun test` — the unit suite. No host and no tmux needed.
- `bun run typecheck` — `tsc --noEmit`.
- `OPENCODE_TMUX_TEST=1 bun test test/integration.test.ts` — the opt-in live suite, which
  drives a real tmux. It skips unless that variable is set.

Run the unit suite and the typecheck before claiming a change is done, and run the live
suite when the change touches tmux argv, the guards, or the editor command.

## Live tmux safety

Integration tests and any manual probing must create their own detached session
(`tmux new-session -d -s <name>`) and clean it up in a `finally`. Never create panes or
windows in a session someone is working in, and never target the agent's own pane.

## Commits

Conventional commits, one per task. Work on a feature branch rather than directly on
`main`, and do not push without being asked.

## Documentation

Reference a file, a function, or a test by name. Do not cite line numbers, since they
drift. Do not put totals such as test counts in prose, since the repo already derives
them and they go stale; say what a command is for, not how much it runs.

## AI disclosure

The README carries the AI disclosure, under `AI Disclosure`, with two subsections,
`Contribution split` and `Models`. Keep both current as the work moves.

The split is an estimate of how the work was divided, not a measurement, so settle the
percentages with the user rather than setting them alone. There is a row per phase:
architecture, requirements, implementation, testing, review, and documentation.

Each row is one cell holding the human percentage, the bar, and the AI percentage. In the
bar the divider is the axis and sits at a fixed column, so the two sides are separate
gauges on the same hundred-point scale rather than one bar split at a point. Each side is
ten cells wide, one cell per ten points, filled outward from the divider with `█` and
leaving the rest in `░`, so a side draws `floor(percent / 10)` cells. Regenerate the rows
with a script rather than adjusting the spacing by hand, since hand-padding drifts and the
divider stops lining up.

Pad so the bar starts at the same offset on every row, and pad after the percentage rather
than before it: spaces inside the cell survive rendering, while leading spaces are
stripped.

The `Models` list names each model used and the phases it covered, and stays limited to
models that actually ran the work. Ask before recording a model that has not.

## Versioning

`package.json` holds the plugin version. On a new feature, bump it as part of that work,
and agree with the user which part of the version moves:

- major, for a break in the surface: a renamed or removed tool, or changed option
  semantics.
- minor, for new capability that keeps the existing surface: a tool, a skill, or an
  option.
- patch, for a fix, or for documentation only.

Ask rather than choosing the part alone, and make the bump part of the same change as the
feature it describes.
