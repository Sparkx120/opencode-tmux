---
name: Tmux
description: Interact with tmux panes and windows: inspect context, name panes/windows, create and kill panes/windows, send commands, run commands and capture output
---

# Tmux

Use the `tmux_*` tools to drive tmux directly. They act on real panes; there is no shell wrapper.

## Addresses

A tmux session holds windows, and a window holds panes. You address a pane three ways:

- `session:window.pane` — a coordinate such as `work:0.1`. Readable, but it shifts when windows or panes are added, removed, or reordered.
- `%pane_id` — a stable pane id such as `%1`. tmux never reuses a live id.
- `@window_id` — a stable window id such as `@1`.

Prefer ids. Coordinates are fine for a target you just read from `tmux_context`, but ids stay correct while you work. A bare target like `%1` is a pane; `@1` is a window.

## The agent's pane

`$TMUX_PANE` is the value inherited from whatever launched the `opencode serve` daemon. The daemon is long-lived and shared by every TUI, so this value is per-daemon, not per-session: it names the pane that launched the daemon, which may be a different session's pane. The agent owns no tmux client.

When a tool has no `target`, the anchor is resolved in this order:

1. The plugin `pane` option, if set. It is a manual pin and is trusted as-is.
2. The pane whose current path matches the session's location directory. This is the session's own pane. When several panes share the directory, the one running the opencode TUI wins; if that is still ambiguous, resolution falls through rather than guessing.
3. `$TMUX_PANE`.

Tools verify the resolved target before acting; a target that no longer exists is reported rather than used, with a suggestion to pass a target or set the `pane` option. Call `tmux_context` to see which pane a tool will act on: it prints the agent pane first, labelled with how it was resolved, then every pane in every session, and it skips the agent line when the anchor is unavailable.

The plugin `pane` option overrides the directory match. Use it only when the heuristic cannot find the right pane.

## Tools

### `tmux_context`

No arguments. Prints the agent's session, window, and pane, then a line per pane with its address, `pane_id`, `title`, and running command. Call it first to learn the ids you will pass to the other tools.

### `tmux_name`

Input: `kind` (`pane` or `window`), `name`, optional `target`.

Names a pane (sets its title) or a window. Name panes and windows for their purpose by default: pass `name` when you create them with `tmux_new`, or rename later with `tmux_name`. Later targets are readable that way, but still pass the id: names are not unique.

Naming also turns the program's own title or rename off for that one pane or window, so the name is not overwritten by the next prompt redraw or title escape. The trade is that the pane title no longer reflects the program running in it; the running command is still shown by `tmux_context` in its `cmd=` field, so use that to tell what a pane is doing.

### `tmux_new`

Input: `kind` (`pane` or `window`), optional `target`, `name`, `command`, `place`, `size`, `focus`.

Creates a pane or window and returns its id. It is detached by default; set `focus` true to activate the new pane or window instead.

- `kind: pane` splits the target pane, so give a pane id, not a window. `place` is `bottom` (default), `top`, `right`, `left`. `size` goes to tmux's `-l` and accepts its forms (`20`, `30%`); it measures lines for a top/bottom split and columns for a left/right split. `name` sets the pane title after creation.
- `kind: window` creates a window in the agent's session: the target resolves to its session id first, so the window lands next to the agent's own window rather than in an undefined "current" session. `place` is `after` (default) or `before`. `size` is rejected, because a window takes its size from the client.

`command` runs as `<shell> -c <command>`, where `shell` is the plugin option (default `sh`), so pipes, redirects, `&&`, and globs work. A call that carries a `command` goes through the shell permission gate first.

### `tmux_kill`

Input: `kind` (`pane` or `window`), optional `target` (defaults to the agent pane).

Kills a pane or window. It refuses the agent's own pane, and refuses the window that contains it, with no override: killing either ends the session. A refusal is a plain message, not an error. The existence probe runs first, so a missing target gets the stale-target message. Use it to close a pane you created once it is no longer needed.

The anchor guard is shared: `tmux_send` also refuses the agent pane, because typing into it drives the agent's own TUI. Pass a target of another pane.

`tmux_exec` targets no pane at all: it creates its own, so it splits the anchor rather than typing into it.

### `tmux_send`

Input: `text`, `target` (required in practice), optional `literal` (default true), `enter` (default true).

Sends `text` to a pane, then a separate Enter when `enter` is true. The target must be a pane other than the agent's own: an omitted target resolves to the agent pane and is refused, so pass an explicit target. With `literal` true the text is sent verbatim, so `|`, `"`, and `;` stay literal instead of being read as key names. Set `literal` false only to send a key name such as `C-c`. To run a shell command, send the command as normal text: tmux sends it to the pane's shell, plus Enter. The text is written into the pane's existing shell, so `tmux_send` does not wrap it in a shell; this call still goes through the shell permission gate.

This is the only path that writes keys into a pane, and typing is its whole purpose. Never use it to find out what a pane is doing: whatever you send stays on screen in front of whoever is using that pane.

### `tmux_exec`

Input: `command`, optional `new` (`pane` or `window`, default `pane`), `place`, `focus`, `timeoutMs`.

Runs a shell command in a pane of its own and returns only the command's output, followed by a trailer on its own line with the real exit status: `[tmux_exec: exit 0]`. Nothing is typed into any pane, so there is no echoed command line and no shell prompt to slice out.

The tool creates a pane, split from the anchor pane (or a window in the anchor's session with `new: window`), then runs the command as that pane's process. It sets `remain-on-exit` on the pane first, so the pane survives the command's exit just long enough to read the output and tmux's own exit status, and then closes the pane or window. Nothing is left behind on the success path. `place` and `focus` behave as in `tmux_new`.

`timeoutMs` bounds how long the tool waits for the command (default 800 ms). A command that outlives it is left running and its pane is not closed; the trailer names the pane so you can keep watching it or close it: `[tmux_exec: still running after 800ms, pane %42]`.

The command goes through the shell permission gate with the raw command as the resource, so the usual shell rules still govern it; `tmux_exec` is not a way around them.

### `tmux_capture`

Input: `target`, optional `start`, `end`, `escapes`.

Reads a pane's visible contents. It polls until two consecutive reads match, because the pane redraws after the command and a single immediate read can miss the trailing prompt. `start` and `end` bound a scrollback range; keep `start` within the pane's real history or the capture comes back near-empty. Set `escapes` to keep ANSI sequences.

## Pitfalls

- Never learn about a pane by typing into it. Read panes directly: `tmux_context` for the pane list and the anchor, `display-message` for a pane's fields, `tmux_capture` for its contents. A pane is someone's workspace, and a key sent to it leaves residue, since a stray Enter prints a fresh prompt line and stays on screen. `tmux_send` is the only tool that types into a pane, and typing is its entire purpose.
- Send literal text with a separate Enter. Without `-l`, tmux parses `|`, `"`, and `;` as key names; the tool does this for you, but the same rule applies to raw `send-keys`. Terminate flags with `--` before the text, so leading-dash text is not read as an option: `send-keys -t <pane> -l -- <text>`.
- Capture output lags the redraw. The tool waits for the pane to settle; if a program is still writing, expect the newest lines only on a later read.
- Geometry comes from `display-message`, not from the process. The agent is not a tty, so terminal queries fail; ask tmux for rows, columns, and layout instead.
- Bound `-S` ranges to the pane's scrollback. A range deeper than the pane's history returns almost nothing.
- `split-window -d -P -F '#{pane_id}'` returns the new pane id without changing focus. Use the returned id; do not guess it.
- Clean up with `tmux_kill`, or raw `kill-pane -t <id>` and `kill-session -t <name>`. Kill by id or name, never by index. `tmux_kill` refuses the agent's own pane and its window.
- `$TMUX_PANE` is inherited by the shared daemon and can point at another session's pane. The anchor is normally the pane whose path matches the session's directory; pass a target from `tmux_context` if a tool reports the anchor missing.
- The agent's shell is not a tmux client. The anchor comes from the session directory, the plugin `pane` option, or `$TMUX_PANE`, in that order of preference after an explicit target.
