# opencode-tmux

An OpenCode V2 plugin that adds a small set of tmux tools and one `tmux` skill that documents how to use them.

## What it does

- Registers lean tools to inspect a tmux session, name panes and windows, create panes and windows, send text, and capture pane output.
- Registers a `tmux` skill that teaches the model the session/window/pane model, target syntax, and the pitfalls of driving tmux from a non-tty process.

The tools act on the pane the agent runs in by default, resolved from `$TMUX_PANE`. The `pane` option overrides that anchor for a fixed target.

## Install

Add a `plugins` entry to `opencode.jsonc`. The object form lets you set the `pane` option:

```jsonc
{
  "plugins": [
    { "package": "opencode-tmux", "options": { "pane": "%6" } }
  ]
}
```

`pane` is optional. Without it, an omitted tool target resolves to `$TMUX_PANE`. It accepts a pane id such as `%6`, or a coordinate such as `work:0.1`.

## Tools

- `tmux_context` — show the agent's session, window, and pane, and every pane.
- `tmux_name` — name a pane or window.
- `tmux_new_pane` — create a pane and return its id.
- `tmux_new_window` — create a window and return its id.
- `tmux_send` — send text or a command to a pane.
- `tmux_capture` — read a pane's contents, waiting for it to settle.

Every tool description tells the model to load the `tmux` skill first. The skill carries the addressing model, the argument reference for each tool, and the known pitfalls.
