# Architecture

This records the architecture that was directed and agreed while building the plugin: the
shape it took and the reasoning behind each choice. The file and module map lives in
`AGENTS.md`.

## Shape

An OpenCode v2 plugin whose server part is, for now, the entire plugin. Setup registers the
tools and then the skills and returns no cleanup. The entry point is `index.ts` at the
repository root, and the plugin `id` is `tmux`.

## Tool surface

Eight tools, one verb each:

- `tmux_context`, `tmux_new`, `tmux_kill`, `tmux_name`, `tmux_send`, `tmux_capture`,
  `tmux_exec`, `tmux_edit`.

Creation and removal are single tools that take a `kind` option rather than one tool per
target type. That keeps the surface small and avoids near-duplicate tools whose
descriptions the model would have to disambiguate.

Options are explicit and named. There is no raw tmux flag passthrough: an option that
forwarded an unvalidated string into tmux as flags would reintroduce exactly the flag
guessing the schemas exist to avoid.

## Skills

Skill bodies are `SKILL.md` directories under `skills/`, loaded by the plugin and
registered through the skill transform at setup. The plugin therefore owns and ships its
skills, rather than depending on a skill source being configured alongside it.

## Target resolution

Every tool that acts on a pane has to know which pane is the agent's own. The anchor is
resolved per session from the session's location directory: the pane whose current path
matches that directory, preferring one whose current command is the OpenCode process.

This exists because the OpenCode server is a shared, long-lived daemon. It inherits
`TMUX_PANE` from whichever pane launched it, which on a machine running several sessions
is not the pane the asking session lives in. Resolution order, highest first: an explicit
per-call target, the plugin `pane` option, the directory match, then `$TMUX_PANE`.

## Anchor protection

The anchor is the agent's own TUI. Killing it ends the session, and typing into it writes
into the agent's own prompt. Each tool that could do either refuses the anchor, with no
override:

- `tmux_kill` refuses the anchor pane and the window that contains it.
- `tmux_send` refuses the anchor pane, since it would type into the agent's own prompt.
- `tmux_exec` needs no refusal: it injects nothing into an existing pane, and splits the
  anchor to create its own.

## Permission model

Anything that would run a command asserts OpenCode's `shell` permission action, so the
existing shell rules decide rather than the plugin inventing a gate of its own. The
resource differs by tool:

- `tmux_send`, `tmux_new` with a command, and `tmux_exec` assert the raw command, so
  per-command rules still govern and the exec tool cannot become a way around them.
- `tmux_edit` asserts a namespaced resource, `tmux_edit <path>`, so a single config rule
  covers the editor whatever `$EDITOR` resolves to.

The editor command is prefixed with `exec` so the shell is replaced and the pane lives for
as long as the editor. That prefix collides with a hardened deny rule on `exec *`. The
namespaced resource plus one narrower allow rule resolves the collision without loosening
anything else in the permission set.

## Command execution and output

`tmux_exec` takes no `target`: driving a command into an existing pane is `tmux_send`'s
job, and the exec tool always creates its own pane or window, split from or placed in the
anchor's session. It injects nothing into a pane, creating its own pane with its shell,
setting `remain-on-exit` on it, and running the command as that pane's process with
`respawn-pane -k`.
Running the command directly, rather than typing it into an interactive shell, is what
keeps the output clean: there is no echoed command line and no prompt to slice out. The
pane keeps its shell until the respawn, so setting the option cannot race a fast command
into a dead pane, and `remain-on-exit` keeps the pane alive after the command exits so its
output stays readable until it is captured.

Completion is the pane's own `#{pane_dead}` flag, which tmux sets when the command exits,
bounded by the timeout. The exit status is read from `#{pane_dead_status}` the same way, so
it is tmux's real status rather than a parsed one. The pane is captured with `-S -` for the
whole scrollback and then closed. A command that outlives the timeout is left running, its
pane is not closed, and the trailer names the pane for the caller to watch or kill.

This supersedes an earlier design that typed a sentinel-bracketed command into an existing
or created pane and sliced the output between the markers. It was fragile: the markers
could scroll out of the pane's history, and an interactive shell echoed the command back
and redrew a prompt around the output. Running the command as the pane process removes the
scrape entirely.

The dead-pane banner tmux draws is suppressed by setting `remain-on-exit-format` to empty.
An older tmux that ignores the option has the single banner line stripped from the capture
instead.

## Editor

The editor is resolved once, in the plugin: the `editor` option, then `$EDITOR`, then
`vim`, then `nano`, and a message with nothing opened when none resolve. The value is
interpolated unquoted so it can carry its own arguments, with only the path quoted.
Family detection (vim or nvim against nano) keys on the first whitespace-separated token,
so an editor carrying arguments is still recognised.

NERDTree is probed once at plugin setup, using vim in ex mode with nocompatibility forced.
Plain ex mode starts vi-compatible and does not load packages, so a probe without that
flag would report NERDTree absent no matter what is installed.

## Conventions

- Commands run through a pane go through the configured shell as `<shell> -c <command>`,
  defaulting to `sh`, so pipes, redirects, and globs work.
- Every tool probes the resolved target for existence before acting, so a stale anchor
  fails with a clear message instead of a raw tmux error.
- Every tool returns text. No `execute` throws.

## Release process

A release is cut from `main` with an annotated tag named for the version it carries, and
the tag matches the `version` in `package.json`. The GitHub release body follows the release
notes schema, which fixes the sections and their order. The notes start from the previous
release rather than a blank page: its body is fetched and edited forward, so the running
record and the sections that did not change are kept.

## Testing and loading

Pure builders and helpers are unit-tested with plain values; the host-facing seams run
over fake context objects; a live suite against a real tmux is opt-in and uses its own
detached sessions.

The plugin is loaded by path from the global configuration, so a source change applies on
reload. A reload re-imports the entry but keeps the existing module graph, so removing,
renaming, or moving an export pairs a cached importer with a newer module and the plugin
fails to load with a missing-export error. A reload does not clear that; a service restart
rebuilds the graph from scratch and is the fix.
