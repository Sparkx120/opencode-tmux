# opencode-tmux

An OpenCode V2 plugin that adds a small set of tmux tools and one `tmux` skill that documents how to use them.

## What it does

- Registers lean tools to inspect a tmux session, name panes and windows, create panes and windows, send text, and capture pane output.
- Registers a `tmux` skill that teaches the model the session/window/pane model, target syntax, and the pitfalls of driving tmux from a non-tty process.

The tools act on the pane the agent runs in by default, resolved from `$TMUX_PANE`. The `pane` option overrides that anchor for a fixed target. A resolved target that no longer exists — a stale `$TMUX_PANE` inherited by the `opencode serve` daemon, for example — is detected before the operation runs and reported, rather than failing with a raw tmux error.

## Install

Add a `plugins` entry to `opencode.jsonc`. The object form lets you set the plugin options:

```jsonc
{
  "plugins": [
    { "package": "opencode-tmux", "options": { "pane": "%6", "shell": "bash" } }
  ]
}
```

Both options are optional.

- `pane` — the default target for tools that take one, including `tmux_new_window`. Without it, an omitted target resolves to `$TMUX_PANE`. It accepts a pane id such as `%6`, or a coordinate such as `work:0.1`.
- `shell` — the shell used to run a `command` for `tmux_new_pane` and `tmux_new_window`. Defaults to `sh`. The command runs as `<shell> -c <command>`, so pipes, redirects, `&&`, and globs work.

## Permissions

The tools that run a command in a shell — `tmux_send`, and `tmux_new_pane` / `tmux_new_window` when they carry a `command` — go through OpenCode's shell permission rules before acting. They assert the same `shell` action OpenCode's own shell tool uses, with the command as the resource, so your existing rules and approvals apply. A denial rejects the tool call with the reason.

## Tools

- `tmux_context` — show the agent's session, window, and pane, and every pane.
- `tmux_name` — name a pane or window.
- `tmux_new_pane` — create a pane and return its id.
- `tmux_new_window` — create a window in the agent's session and return its id.
- `tmux_send` — send text or a command to a pane.
- `tmux_capture` — read a pane's contents, waiting for it to settle.

Every tool defaults its target to the agent pane unless it is given one. Every tool description tells the model to load the `tmux` skill first. The skill carries the addressing model, the argument reference for each tool, and the known pitfalls.
