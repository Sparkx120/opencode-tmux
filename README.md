# opencode-tmux

An OpenCode V2 plugin that adds a small set of tmux tools and two skills that document how to use them.

## What it does

- Registers lean tools to inspect a tmux session, name panes and windows, create and kill panes and windows, send text, run commands and capture their output, and open the user's editor.
- Registers a `tmux` skill that teaches the model the session/window/pane model, target syntax, and the pitfalls of driving tmux from a non-tty process, and a `tmux-editor` skill for opening the user's editor.

The tools act on the pane the agent runs in by default. That anchor is resolved once per session, in this order: an explicit `target` on the call, then the `pane` option, then the pane whose current path matches the session's location directory, then `$TMUX_PANE`. The directory match exists because `opencode serve` is a long-lived daemon shared by every TUI, so the `$TMUX_PANE` it inherited belongs to whichever pane launched the daemon, not to the calling session. When the directory matches more than one pane, one running the opencode TUI wins; if that is still ambiguous, the resolver falls back to `$TMUX_PANE` rather than guessing. A resolved target that no longer exists is detected before the operation runs and reported, rather than failing with a raw tmux error. `tmux_context` labels the anchor line with how it was resolved.

## Install

Add a `plugins` entry to `opencode.jsonc`. The object form lets you set the plugin options:

```jsonc
{
  "plugins": [
    { "package": "opencode-tmux", "options": { "pane": "%6", "shell": "bash", "editor": "nvim" } }
  ]
}
```

The options are optional.

- `pane` — pins the default target for tools that take one, including `tmux_new` and `tmux_kill`. It sits above the directory heuristic, so a pinned pane is never second-guessed. Without it, an omitted target resolves to the session's pane (or `$TMUX_PANE` as a fallback). It accepts a pane id such as `%6`, or a coordinate such as `work:0.1`.
- `shell` — the shell used to run a `command` for `tmux_new`. Defaults to `sh`. The command runs as `<shell> -c <command>`, so pipes, redirects, `&&`, and globs work.
- `editor` — the editor `tmux_edit` opens. The editor is resolved in order: this option, then `$EDITOR`, then `vim`, then `nano`, taking the first that exists. This option and `$EDITOR` may include arguments, such as `vim -f` or `code --wait`; the value is interpolated unquoted and word-split by the shell. The OpenCode server's environment is not the user's interactive shell, so the resolved editor can differ from what the user expects; this option is the fix.

## Permissions

The tools that run a command in a shell go through OpenCode's shell permission rules before acting. They assert the same `shell` action OpenCode's own shell tool uses, so your existing rules and approvals apply, but the resource differs by tool:

- `tmux_send`, `tmux_exec`, and `tmux_new` when it carries a `command`, assert the raw command (the string you would type, not its `<shell> -c` wrapper), so rules such as `bun test*` match, and `tmux_exec` still obeys the shell rules rather than bypassing them.
- `tmux_edit` asserts a namespaced resource, `tmux_edit <path>`, rather than the editor command it constructs. One rule, `tmux_edit *`, then allows opening any file in the editor regardless of which editor is resolved.

A denial rejects the tool call with the reason.

## Tools

- `tmux_context` — show the agent's session, window, and pane, and every pane.
- `tmux_name` — name a pane or window.
- `tmux_new` — create a pane or window and return its id.
- `tmux_kill` — kill a pane or window, refusing the agent's own pane and its window.
- `tmux_send` — send text or a command to a pane.
- `tmux_capture` — read a pane's contents, waiting for it to settle.
- `tmux_exec` — run a shell command in a pane and return its output.
- `tmux_edit` — open the editor on a file or folder, on explicit request only.

Every tool defaults its target to the agent pane unless it is given one. Every tool description tells the model to load the `tmux` skill first. The skill carries the addressing model, the argument reference for each tool, and the known pitfalls.

## AI Disclosure

### Contribution split

| Work type | Human / AI |
| --- | --- |
| Architecture | 75%  ███████│░░░  25% |
| Requirements | 90%  █████████│░  10% |
| Implementation (human oversight) | 0%  │██████████  100% |
| Testing | 0%  │██████████  100% |
| Review | 50%  █████│█████  50% |
| Documentation | 10%  ░│█████████  90% |

### Models

- DeepSeek V4.1 Flash (Hugging Face) — every phase above: architecture, requirements, implementation, testing, review, and documentation.
