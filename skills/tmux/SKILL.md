---
name: Tmux
description: Interact with tmux panes and windows: inspect context, name panes/windows, create panes/windows, send commands, and capture pane output
---

# Tmux

Use the `tmux_*` tools to drive tmux directly. They act on real panes; there is no shell wrapper.

## Addresses

A tmux session holds windows, and a window holds panes. You address a pane three ways:

- `session:window.pane` — a coordinate such as `work:0.1`. Readable, but it shifts when windows or panes are added, removed, or reordered.
- `%pane_id` — a stable pane id such as `%6`. tmux never reuses a live id.
- `@window_id` — a stable window id such as `@1`.

Prefer ids. Coordinates are fine for a target you just read from `tmux_context`, but ids stay correct while you work. A bare target like `%6` is a pane; `@1` is a window.

## The agent's pane

`$TMUX_PANE` is the value inherited from whatever launched the `opencode serve` daemon. The agent owns no tmux client, so this value can be stale: it may name a pane that no longer exists, or a pane from a different session. When a tool has no `target`, it falls back to the plugin `pane` option and then to `$TMUX_PANE`. Tools verify the resolved target before acting; a target that no longer exists is reported rather than used, with a suggestion to pass a target or set the `pane` option. Call `tmux_context` to see which pane a tool will act on: it prints the agent pane first, then every pane in every session, and it skips the agent line when the anchor is unavailable.

The plugin `pane` option overrides that fallback. When it is set, an omitted target resolves to the option instead of `$TMUX_PANE`. Use it when `$TMUX_PANE` is wrong or stale.

## Tools

### `tmux_context`

No arguments. Prints the agent's session, window, and pane, then a line per pane with its address, `pane_id`, `title`, and running command. Call it first to learn the ids you will pass to the other tools.

### `tmux_name`

Input: `kind` (`pane` or `window`), `name`, optional `target`.

Names a pane (sets its title) or a window. Name the panes and windows you create so later targets are readable, then still pass the id: names are not unique.

### `tmux_new_pane`

Input: optional `target`, `name`, `command`, `vertical`.

Splits a pane and returns the new pane id. `vertical` defaults to true, which splits below; false splits to the side. The new pane is created detached, so it does not steal focus. Pass `command` to run something in it, and `name` to title it. The tool splits the target pane, so give a pane id, not a window. `command` runs as `<shell> -c <command>`, where `shell` is the plugin option (default `sh`), so pipes, redirects, `&&`, and globs work. A call that carries a `command` goes through the shell permission gate first.

### `tmux_new_window`

Input: optional `target`, `name`, `command`.

Creates a detached window in the agent's session and returns its window id. The target is resolved to its session id first, because `new-window` takes a session, not a pane: a pane id fails with "can't specify pane here". The window lands in the agent's session next to its own window, instead of in an undefined "current" session. `command` runs as `<shell> -c <command>` (the plugin `shell` option, default `sh`). A call that carries a `command` goes through the shell permission gate first. Use it for long-running work that deserves its own window rather than a split.

### `tmux_send`

Input: `text`, optional `target` (defaults to the agent pane), `literal` (default true), `enter` (default true).

Sends `text` to a pane, then a separate Enter when `enter` is true. With `literal` true the text is sent verbatim, so `|`, `"`, and `;` stay literal instead of being read as key names. Set `literal` false only to send a key name such as `C-c`. To run a shell command, send the command as normal text: tmux sends it to the pane's shell, plus Enter. The text is written into the pane's existing shell, so `tmux_send` does not wrap it in a shell; this call still goes through the shell permission gate.

### `tmux_capture`

Input: `target`, optional `start`, `end`, `escapes`.

Reads a pane's visible contents. It polls until two consecutive reads match, because the pane redraws after the command and a single immediate read can miss the trailing prompt. `start` and `end` bound a scrollback range; keep `start` within the pane's real history or the capture comes back near-empty. Set `escapes` to keep ANSI sequences.

## Pitfalls

- Send literal text with a separate Enter. Without `-l`, tmux parses `|`, `"`, and `;` as key names; the tool does this for you, but the same rule applies to raw `send-keys`. Terminate flags with `--` before the text, so leading-dash text is not read as an option: `send-keys -t <pane> -l -- <text>`.
- Capture output lags the redraw. The tool waits for the pane to settle; if a program is still writing, expect the newest lines only on a later read.
- Geometry comes from `display-message`, not from the process. The agent is not a tty, so terminal queries fail; ask tmux for rows, columns, and layout instead.
- Bound `-S` ranges to the pane's scrollback. A range deeper than the pane's history returns almost nothing.
- `split-window -d -P -F '#{pane_id}'` returns the new pane id without changing focus. Use the returned id; do not guess it.
- Clean up with `kill-pane -t <id>` and `kill-session -t <name>`. Kill by id or name, never by index.
- `$TMUX_PANE` is inherited and can be stale. Tools verify the resolved target before acting; if a target is reported missing, pass a target from `tmux_context` or set the plugin `pane` option.
- The agent's shell is not a tmux client: `$TMUX` and `$TMUX_PANE` are the only anchors, and the plugin `pane` option can override the latter.
