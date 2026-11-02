# Future plans

This is the queue of work that is planned or has been deliberately deferred: each item says
what it is, why it is not done, and what would have to change to do it. It complements
`requirements.md`, which holds the specification the implementation answers to, and
`architecture.md`, which holds the design and its reasoning. Items move out of here when
they are built, and into here when a decision defers something rather than building it.

## Per-session pinning of the default pane

The `pane` plugin option is global, so pinning a pane applies to every session on the
server, not only the session that wanted it. A machine running several sessions cannot pin
one session's pane without pinning it everywhere.

Not done because the plugin option is flat and read once per registration; a per-session
value needs a source that can differ by session. A per-session pin, or a per-project config
keyed on the session's location directory, would fix it. The session directory is already
resolved for the anchor, so the data is present; what is missing is a place to read a
per-session decision from and a rule for precedence against the global option.

## Directory anchor fallback to `$TMUX_PANE`

When more than one pane in the session's location directory matches and none of them runs
the OpenCode TUI, the anchor resolver falls back to `$TMUX_PANE`. On a shared daemon that
value belongs to whichever pane launched the daemon, so the fallback can still pick the
wrong pane.

Not done because there is no better signal in the pane list at that point than the inherited
environment variable. A change would need a stronger disambiguator, such as a per-session
marker the plugin writes on first use, or a way to ask the calling session which pane it is
without guessing.

## Reaping or keeping the pane `tmux_exec` leaves running

A command that outlives `timeoutMs` is left running, its pane is not closed, and the trailer
names the pane for the caller to kill or keep watching. This is by design, but it is the
only behaviour available: there is no option to reap the pane automatically, and no option
to keep the pane deliberately on the success path.

Not done because the useful default was the conservative one, and no caller has needed the
alternative yet. A change would add an option to `tmux_exec` for the timeout path, or a
separate call that reaps the panes a run left behind, and would have to keep the trailer's
promise that the named pane is still alive.

## Editor resolution from the pane

The resolved editor comes from the OpenCode server's environment, which is not the user's
interactive shell, so the resolved editor can differ from what the user expects. The
`editor` option is the current fix.

Not done because resolving the editor in the target pane would mean running a shell command
there to read `$EDITOR` and the `PATH`, which is both slower and harder to report back
clearly, and it would run a command in a pane for a decision the plugin could make from what
it already has. A change would resolve in the pane and surface the result unambiguously in
the tool's reply.

## Typing into the agent's own pane

`tmux_send` refuses the agent's own pane, since typing into it drives the agent's own TUI.
There is no override and no other path to write text into that pane, so a caller that
genuinely needs to cannot.

Not done because the refusal protects the agent's prompt, and no safe way to type into it
without disturbing the TUI has been found. A change would need a guard that distinguishes
text the agent's own session intends from text it does not.

## `tmux_exec` closes its own pane

The pane or window `tmux_exec` creates is closed when the command finishes, so its output is
only available from the returned capture. There is no way to keep the pane to read the
output later.

Not done because closing what it created keeps a successful run from leaving anything
behind, which is the property the tool is built around. A change would add an option to keep
the pane, and would then owe the caller the pane's target and a rule for who closes it.

## The dead-pane banner on older tmux

The banner tmux draws for a dead pane is suppressed by setting `remain-on-exit-format` to
empty. A tmux old enough to ignore that option instead has the single banner line stripped
from the capture.

Not done because the fallback works and the older tmux is only relevant to `tmux_exec`'s
capture. A change would either require a newer tmux or extend the capture cleaning, which
already handles the known banner text.

## Detecting whether naming can work at all

Naming sets a scoped option before setting the name: `allow-set-title` off for a pane,
`allow-rename` off for a window. That option is what keeps the name from being overwritten
by the program that owns the title. A tmux without it cannot make a name stick, and
`tmux_name` is registered regardless, so on such a build the tool would report a name that
is gone by the next prompt.

Not done because no build without those options has been exercised, and this host has both.
A change would probe once at setup for the options naming depends on, and register
`tmux_name` only when every one is present. When one is missing it would drop the tool
entirely, stop `tmux_new` quietly accepting a `name` that cannot be honoured, and say so in
`tmux_context` and in the `tmux` skill, so the absence is visible rather than silent.

## Inspecting a pane without typing into it

The rule the code already follows: nothing learns about a pane by sending keys into it. The
existence probe, the anchor, the context, and a capture all read panes through
`display-message`, `list-panes`, or `capture-pane`, and `send-keys` appears only in
`tmux_send`, where typing is the entire point. A pane is the user's workspace, and every key
sent to it leaves residue in something the user is looking at.

The rule is stated in the `tmux` skill, both in its pitfalls and in the `tmux_send` section, so a session that reads the skill before touching tmux has it. What is deferred is making the rule sufficient for an investigation rather than merely stated. `tmux_context` reports each pane's address, id, title, and current command, but not its size, whether it is the active pane, or whether it is dead, so an inspector who needs those has no direct way to ask.

Not done because none of those fields has been needed yet and the context output is kept
compact. A change would add them, so anything an inspection reaches for is available from
pane information alone.

## Portable alignment of the contribution split

The contribution split in the README is a Markdown table whose bar cell uses a code span
and non-breaking-space padding, so its alignment depends on the renderer: the inline code
must be rendered in a monospace face and the non-breaking space must survive instead of
collapsing or being trimmed. A renderer that does otherwise moves the divider and the
percentage fields, and the table reads as misaligned in its raw source.

Not done because the table is preferred for its structure, a header row and a labelled
phase column that a reader or a tool can address and a code block cannot carry, and the
renderer the README is published on keeps the alignment. A change would move the split to a
fenced code block of plain-space-padded lines, which holds across renderers and is aligned
in the raw source, and would trade away the table semantics and the labelled rows.
