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
into the agent's own prompt. Removal refuses the anchor pane and the window containing it,
with no override, and the tools that write to a pane refuse the anchor.

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

`tmux_exec` brackets its command with a per-call sentinel and slices the output between
the markers, so the caller gets the command's output rather than the pane scrapings around
it. Completion waits for the end sentinel rather than for the capture to stop changing:
a fresh pane is momentarily stable between the key send and the command's first output, so
stability is not evidence that the command finished. When the markers cannot be found, the
raw capture comes back with a note instead of silently partial output.

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

## Testing and loading

Pure builders and helpers are unit-tested with plain values; the host-facing seams run
over fake context objects; a live suite against a real tmux is opt-in and uses its own
detached sessions. The plugin is loaded by path from the global configuration, so a source
change applies on reload, while a stale module graph needs a service restart.
