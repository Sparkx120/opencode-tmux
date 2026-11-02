# Requirements

The requirements below were set out for this plugin over the course of its build. They are
recorded here as the specification the implementation answers to.

## Scope

An OpenCode v2 plugin for tmux integration, in a repository of its own. It gives the agent
tmux capabilities through tools, and teaches their use through skills.

## Skills and tools

- Skills come first: the plugin exposes a small set of skills before it grows anything
  else.
- A core `tmux` skill carries basic knowledge of driving tmux alongside a person. It
  covers how to determine the agent's own pane and window, set pane and window names,
  create panes and windows, write a command into one of them, and read a pane or window
  back with a capture.
- Where a skill would otherwise spell out long command strings, the plugin provides a tool
  and the skill explains how to use it, so the skill stays short.
- Tools stay lean: precise functions with clear, simple descriptions.
- Every tool description points at the `tmux` skill, so a request involving tmux loads the
  skill first for context.
- Panes and windows should be named for their purpose by default.

## Creation and removal

- One tool creates panes and windows, chosen by a `kind` option, with well-defined schema
  parameters for positioning, sizing, and the command to run.
- Naming is done by the separate name tool as a follow-up. The create tool keeps its own
  `name` option for simplicity.
- One tool removes panes and windows, chosen by a `kind` option.
- The pane the agent itself runs in is unkillable.

## Editor skill

- A separate `tmux-editor` skill opens the user's editor.
- The editor is taken from `$EDITOR`. When that is unset, `vim` or `nano` is used if
  either is installed. When neither is, the user is told that no editor is known and
  nothing is opened.
- The editor opens in a tmux pane to the right or the left of the OpenCode instance, right
  by default.
- It opens a requested file, or an entire folder when that is asked for. With NERDTree
  installed, a folder opens with NERDTree active on it.
- Focus moves to the editor by default, with an option to open it without taking focus for
  view-only use.
- The tool and the skill both state that they are used only when the user explicitly asks
  for an editor.
- An associated tool keeps the skill from becoming verbose with command strings.

## Execution

- A general-purpose exec runs a command in a pane of its own and returns its output and
  exit status. It writes nothing into any pane it does not own, and it cleans up the pane
  it created. A command that outlives the tool's timeout is left running and reported.
- Commands run through the plugin are permissioned explicitly, so a hardened shell
  permission set stays intact instead of being loosened to accommodate the plugin.

## Project documentation and metadata

- A README covering what the plugin does, how to install and configure it, and the tools
  it registers.
- The install instructions reference the GitHub remote, so the plugin is added by its
  repository spec rather than from a local path.
- The README carries a disclaimer of its early alpha or beta status, noting that the tool
  surface, options, and skills may still change in ways that break configuration.
- An AI disclosure in the README: the contribution split per work type, and the models
  used. It is kept current as the work moves, with the split settled between the user and
  the agent.
- A base `AGENTS.md` describing how to work in the repository, build, and test.
- The repository stays private to start, published under a personal GitHub account, with
  the remote named `github`.

## Repository hygiene and release

- The repository stays free of machine-specific values and secrets. No absolute home paths,
  usernames, hostnames, or the names of other projects appear in the tree, and the tree is
  checked for these before it is published.
- The version in `package.json` moves with a feature, and the part that moves (major, minor,
  or patch) is agreed between the user and the agent.
- A release is cut from `main` with an annotated tag matching the `package.json` version and
  published as a GitHub release whose notes follow the release notes schema.
