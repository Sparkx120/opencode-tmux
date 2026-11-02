---
name: Tmux Editor
description: Open the user's editor in a tmux pane or window on a file or folder; use only when the user explicitly asks for it
---

# Tmux Editor

Use the `tmux_edit` tool to open the user's editor on a file or folder, in a new tmux pane or window. Open an editor only when the user explicitly asks to edit or open a file; do not open one on your own initiative.

## What it does

`tmux_edit` resolves an editor, builds a command, and creates a pane or window that runs it. The pane command is `exec <editor> <path>`, so the shell is replaced by the editor and the pane lives as long as the editor does.

Input: `path` (a file or a directory), optional `placement` (`right` default, `left`, `window`), `focus` (default true), and optional `target`.

## Editor resolution

The editor is resolved once, in this order:

1. The plugin `editor` option.
2. `$EDITOR`.
3. `vim`, then `nano`, if present on the server's PATH.

The option and `$EDITOR` may carry arguments, such as `vim -f` or `code --wait`; the value is word-split by the shell, with only the file path quoted.

The environment is the server's, not the user's interactive shell, so the resolved editor can differ from what the user expects. The `editor` option is the fix. When nothing resolves, the tool returns a message naming these three ways and opens nothing.

## Placement and focus

- `right` (default) and `left`: split the anchor pane sideways, with `left` placing the new pane before the anchor.
- `window`: create a window in the agent's session, named after the basename of `path`.

`focus` defaults to true, so the user lands in the editor. `focus: false` opens it without stealing focus, for view-only use.

## Folders and NERDTree

When `path` is a directory and the editor is vim or nvim, NERDTree is used if the plugin found it at startup, as `vim -c 'NERDTree <dir>'`. Without NERDTree the directory is opened as a normal argument, which vim renders with netrw. nano cannot browse a folder, so the tool reports that instead of opening it.

A directory opened this way is a file browser, not an edit of one file: the user picks the file inside NERDTree or netrw.

## Closing the pane

When the user is done, close the editor pane with `tmux_kill` (`kind: pane`, `target: <pane id>`). `tmux_kill` refuses the agent's own pane and its window, so it is safe to use for cleanup.
