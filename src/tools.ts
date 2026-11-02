// The six lean tmux tools. Each execute gets the raw JSON-schema args (cast)
// and returns { content: <string> } to the model; a missing target or a tmux
// error becomes a text message, never a thrown error. The runner and env are
// injectable so tests exercise the glue without touching a real tmux server.

import type { Plugin } from "@opencode/plugin"
import { basename } from "node:path"
import { statSync } from "node:fs"
import { chooseAnchor, listPanesArgv, parsePaneRows, type AnchorSource, type PaneRow } from "./anchor.js"
import {
  editorInvocation,
  isVimFamily,
  NERD_TREE_PROBE_ARGS,
  probeNerdTree,
  resolveEditor,
  type EditorExec,
  type ResolvedEditor,
} from "./editor.js"
import {
  captureArgv,
  cleanExecCapture,
  contextArgv,
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_SHELL,
  execTimeoutTrailer,
  execTrailer,
  killArgv,
  nameSequence,
  newArgv,
  PANE_PLACES,
  paneDeadArgv,
  paneDeadStatusArgv,
  paneOptionArgv,
  respawnArgv,
  run as defaultRun,
  sendKeysArgv,
  sessionForArgv,
  settleCapture,
  targetExistsArgv,
  waitForPaneDead,
  WINDOW_PLACES,
  windowForArgv,
  type NewKind,
  type PanePlace,
  type WindowPlace,
} from "./tmux.js"
import type { Runner } from "./tmux.js"

const NO_TARGET =
  "no tmux target available: pass a target, set the plugin `pane` option, or run inside tmux with $TMUX_PANE set"

// The anchor is the agent's own pane; killing it, or its window, would end the
// session, so the guard is absolute. A plain message, not an error.
const REFUSE_ANCHOR_PANE =
  "refusing to kill the anchor pane: it is the agent's own pane, and there is no override. Pass a different target."
const REFUSE_ANCHOR_WINDOW =
  "refusing to kill the window containing the anchor pane: it holds the agent's own pane, and there is no override. Pass a different target."
// Typing into the anchor drives the agent's own TUI, so the same guard applies.
const REFUSE_ANCHOR_INPUT =
  "refusing to type into the anchor pane: it is the agent's own TUI, and there is no override. Pass the target of another pane."

// The action name OpenCode's own shell tool uses (packages/core tool/plugin/shell.ts
// sets `action: name` with `name = "shell"`), so the same permission rules apply.
const SHELL_ACTION = "shell"

function staleTarget(target: string): string {
  return `tmux target "${target}" does not exist (stale $TMUX_PANE?); pass a target or set the plugin \`pane\` option`
}

// How the anchor line reads in tmux_context, so a wrong anchor is obvious.
function sourceNote(source: AnchorSource): string {
  switch (source) {
    case "option":
      return "(from plugin `pane` option)"
    case "directory":
      return "(from session directory)"
    case "env":
      return "(from $TMUX_PANE)"
    case "explicit":
      return "(from explicit target)"
    default:
      return ""
  }
}

// The pane list feeds the directory heuristic; an absent location means the
// heuristic is skipped, so no tmux call is made for it.
async function loadPaneRows(runner: Runner, directory: string | undefined): Promise<PaneRow[]> {
  if (!directory) return []
  const res = await runner(listPanesArgv())
  if (res.code !== 0) return []
  return parsePaneRows(res.stdout)
}

function paneOption(ctx: Plugin.Context): string | undefined {
  const value = ctx.options.pane
  return typeof value === "string" ? value : undefined
}

function shellOption(ctx: Plugin.Context): string {
  const value = ctx.options.shell
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_SHELL
}

function editorOption(ctx: Plugin.Context): string | undefined {
  const value = ctx.options.editor
  return typeof value === "string" && value.length > 0 ? value : undefined
}

// Injectable edges for `tmux_edit`: the NERDTree probe and the directory check.
export interface ToolDeps {
  /** Runs a binary; defaults to a real exec. Used for the NERDTree probe. */
  exec?: EditorExec
  /** Whether a path is a directory; defaults to fs.statSync. */
  isDirectory?: (path: string) => boolean
}

function statIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function editSummary(editor: string, path: string, placement: string, nerdtree: boolean, id: string): string {
  const where = placement === "window" ? "window" : `${placement} pane`
  const via = nerdtree ? " with NERDTree" : ""
  return `opened ${path} with ${editor} in a new ${where}${via}: ${id}`
}

function failure(argv: string[], message: string): { content: string } {
  return { content: `tmux ${argv[0]} failed: ${message}` }
}

export async function registerTools(
  ctx: Plugin.Context,
  runner: Runner = defaultRun,
  env: NodeJS.ProcessEnv = process.env,
  deps: ToolDeps = {},
) {
  const pane = paneOption(ctx)
  const shell = shellOption(ctx)
  const directory = ctx.location?.directory as string | undefined

  // Resolve the editor and probe NERDTree once: neither changes during a run.
  // The probe only runs for a vim-family editor, since NERDTree is vim-only.
  const resolvedEditor: ResolvedEditor = resolveEditor({ option: editorOption(ctx), env })
  const exec = deps.exec ?? probeNerdTree
  const nerdtree =
    resolvedEditor.command !== undefined && isVimFamily(resolvedEditor.command)
      ? (await exec(resolvedEditor.command, NERD_TREE_PROBE_ARGS)) === 0
      : false
  const isDirectory = deps.isDirectory ?? statIsDirectory

  // Resolve the anchor once: the session's location directory identifies its
  // pane, so a shared daemon's stale $TMUX_PANE does not win. A pinned pane
  // option short-circuits the heuristic, so its pane list is never fetched.
  const rows = pane ? [] : await loadPaneRows(runner, directory)
  const anchor = chooseAnchor({ option: pane, rows, directory, env })
  const target = (explicit?: string) => (explicit ? explicit : anchor.target)

  // The resolved target can be a stale $TMUX_PANE the daemon inherited. Probe
  // it before acting so a dead anchor fails clearly instead of with a raw tmux
  // error. The probe echoes the pane id, which the anchor guard also needs.
  const paneOf = async (resolved: string): Promise<string | undefined> => {
    const res = await runner(targetExistsArgv(resolved))
    if (res.code !== 0) return undefined
    const id = res.stdout.trim()
    return id.length > 0 ? id : undefined
  }
  const confirmed = async (resolved: string): Promise<boolean> => (await paneOf(resolved)) !== undefined

  // The window a pane lives in, or the window a window target names.
  const windowOf = async (resolved: string): Promise<string | undefined> => {
    const res = await runner(windowForArgv(resolved))
    if (res.code !== 0) return undefined
    const id = res.stdout.trim()
    return id.length > 0 ? id : undefined
  }

  // The anchor guard, shared by every tool that could kill or type into the
  // agent's own pane. No anchor means nothing to protect.
  const anchorPaneId = async (): Promise<string | undefined> => (anchor.target ? paneOf(anchor.target) : undefined)
  const isAnchorPane = async (paneId: string): Promise<boolean> => (await anchorPaneId()) === paneId
  const isAnchorWindow = async (windowId: string): Promise<boolean> => {
    const anchorId = await anchorPaneId()
    if (!anchorId) return false
    return (await windowOf(anchorId)) === windowId
  }

  // new-window wants a target-window, and a pane is not one. Resolve the pane
  // or window to its session (as `$N:`) for the `-t` argument.
  const sessionOf = async (resolved: string): Promise<string | undefined> => {
    const res = await runner(sessionForArgv(resolved))
    if (res.code !== 0) return undefined
    const session = res.stdout.trim()
    return session.length > 0 ? session : undefined
  }

  return ctx.tool.transform((editor) => {
    editor.add({
      name: "tmux_context",
      description:
        "Show the tmux session, window, and pane the agent runs in, and every pane. Load the `tmux` skill before using tmux tools: it explains ids and targets. No arguments.",
      input: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const anchorTarget = target(undefined)
        const chunks: string[] = []
        let anchorOk = false
        if (anchorTarget && (await confirmed(anchorTarget))) {
          anchorOk = true
        }
        for (const argv of contextArgv(anchorOk ? anchorTarget : undefined)) {
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
          // Note how the agent pane was resolved, so a wrong anchor is obvious.
          const note = argv[0] === "display-message" ? ` ${sourceNote(anchor.source)}` : ""
          chunks.push((res.stdout.trimEnd() + note).trimEnd())
        }
        if (!anchorTarget) {
          chunks.unshift(
            "No agent pane available (set $TMUX_PANE or the plugin `pane` option); listing all panes.",
          )
        } else if (!anchorOk) {
          chunks.unshift(
            `Anchor pane ${anchorTarget} is unavailable (stale $TMUX_PANE?); listing all panes instead.`,
          )
        }
        return { content: chunks.filter((c) => c.length > 0).join("\n") }
      },
    })

    editor.add({
      name: "tmux_name",
      description: "Name a pane or window. Load the `tmux` skill first. Input: kind (pane|window), name, optional target.",
      input: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pane", "window"], description: "What to name" },
          name: { type: "string", description: "New pane title or window name" },
          target: { type: "string", description: "Pane or window target; defaults to the agent pane" },
        },
        required: ["kind", "name"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = raw as { kind?: string; name?: string; target?: string }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
        if (args.kind !== "pane" && args.kind !== "window") {
          return { content: 'tmux_name: kind must be "pane" or "window"' }
        }
        if (!args.name) return { content: "tmux_name: name is required" }
        // The name has to outlast the program: disabling its own title or
        // rename comes first, so a prompt redraw does not overwrite the name.
        for (const argv of nameSequence(args.kind, resolved, args.name)) {
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
        }
        return { content: `named ${args.kind} ${resolved} as ${args.name}` }
      },
    })

    editor.add({
      name: "tmux_new",
      description:
        "Create a pane or window in the agent's session. Load the `tmux` skill first. Input: kind (pane|window), optional target, name, command, place, size (pane only), focus.",
      input: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pane", "window"], description: "What to create" },
          target: {
            type: "string",
            description: "Pane to split, or window whose session anchors a new window; defaults to the agent pane",
          },
          name: { type: "string", description: "Pane title or window name" },
          command: { type: "string", description: "Shell command to run in the new pane or window" },
          place: {
            type: "string",
            enum: [...PANE_PLACES, ...WINDOW_PLACES],
            description: "Pane: bottom (default), top, right, left. Window: after (default), before",
          },
          size: { type: "string", description: "Pane only: tmux size for -l, e.g. 20 or 30%; rejected for a window" },
          focus: { type: "boolean", description: "Activate the new pane or window (default false: detached)" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as {
          kind?: string
          target?: string
          name?: string
          command?: string
          place?: string
          size?: string
          focus?: boolean
        }
        if (args.kind !== "pane" && args.kind !== "window") {
          return { content: 'tmux_new: kind must be "pane" or "window"' }
        }
        const kind: NewKind = args.kind
        if (kind === "window" && args.size !== undefined) {
          return { content: "tmux_new: size is not valid for a window; a window takes its size from the client" }
        }
        const places: readonly string[] = kind === "pane" ? PANE_PLACES : WINDOW_PLACES
        if (args.place !== undefined && !places.includes(args.place)) {
          return { content: `tmux_new: place for a ${kind} must be one of ${places.join(", ")}` }
        }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }

        const opts = {
          kind,
          place: args.place as PanePlace | WindowPlace | undefined,
          size: args.size,
          command: args.command,
          shell,
          focus: args.focus,
        }

        if (kind === "window") {
          const session = await sessionOf(resolved)
          if (!session) return { content: staleTarget(resolved) }
          if (args.command) {
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
              action: SHELL_ACTION,
              resources: [args.command],
              save: [args.command],
            })
          }
          const argv = newArgv(session, opts)
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
          const id = res.stdout.trim()
          if (args.name) {
            for (const call of nameSequence("window", id, args.name)) {
              const named = await runner(call)
              if (named.code !== 0) return failure(call, named.message)
            }
          }
          return { content: `created window ${id}${args.name ? ` named ${args.name}` : ""}` }
        }

        if (args.command) {
          await ctx.permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.messageID, id: context.id },
            action: SHELL_ACTION,
            resources: [args.command],
            save: [args.command],
          })
        }
        const argv = newArgv(resolved, opts)
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        const id = res.stdout.trim()
        if (args.name) {
          for (const call of nameSequence("pane", id, args.name)) {
            const named = await runner(call)
            if (named.code !== 0) return failure(call, named.message)
          }
        }
        return { content: `created pane ${id}${args.name ? ` named ${args.name}` : ""}` }
      },
    })

    editor.add({
      name: "tmux_kill",
      description:
        "Kill a pane or window. Refuses the agent's own pane or the window holding it. Load the `tmux` skill first. Input: kind (pane|window), optional target (defaults to the agent pane).",
      input: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pane", "window"], description: "What to kill" },
          target: { type: "string", description: "Pane or window target; defaults to the agent pane" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = raw as { kind?: string; target?: string }
        if (args.kind !== "pane" && args.kind !== "window") {
          return { content: 'tmux_kill: kind must be "pane" or "window"' }
        }
        const kind: NewKind = args.kind
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        const paneId = await paneOf(resolved)
        if (!paneId) return { content: staleTarget(resolved) }

        if (kind === "pane") {
          if (await isAnchorPane(paneId)) return { content: REFUSE_ANCHOR_PANE }
        } else {
          const targetWindow = await windowOf(resolved)
          if (!targetWindow) return { content: staleTarget(resolved) }
          if (await isAnchorWindow(targetWindow)) return { content: REFUSE_ANCHOR_WINDOW }
        }

        const argv = killArgv(kind, resolved)
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        return { content: `killed ${kind} ${resolved}` }
      },
    })

    editor.add({
      name: "tmux_send",
      description:
        "Send text or a command to a pane other than the agent's own. Load the `tmux` skill first. Input: text, target (required in practice: the agent pane is refused), optional literal (default true), enter (default true).",
      input: {
        type: "object",
        properties: {
          target: { type: "string", description: "Pane target; must be another pane, the agent pane is refused" },
          text: { type: "string", description: "Text to send" },
          literal: { type: "boolean", description: "Send verbatim (default true); false treats the text as key names" },
          enter: { type: "boolean", description: "Press Enter after the text (default true)" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as { target?: string; text?: string; literal?: boolean; enter?: boolean }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (typeof args.text !== "string") return { content: "tmux_send: text is required" }
        const paneId = await paneOf(resolved)
        if (!paneId) return { content: staleTarget(resolved) }
        if (await isAnchorPane(paneId)) return { content: REFUSE_ANCHOR_INPUT }
        const enter = args.enter !== false
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: SHELL_ACTION,
          resources: [args.text],
          save: [args.text],
        })
        for (const argv of sendKeysArgv(resolved, args.text, { literal: args.literal, enter })) {
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
        }
        return { content: `sent ${args.text.length} chars to ${resolved}${enter ? " and pressed Enter" : ""}` }
      },
    })

    editor.add({
      name: "tmux_exec",
      description:
        "Run a shell command in a newly created tmux pane or window and return its output, plus a trailer with the exit status. The pane or window is closed afterwards; a command that outlives timeoutMs is left running and named in the trailer. Load the `tmux` skill first. Input: command, optional new (pane|window, default pane), place, focus, timeoutMs.",
      input: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          new: {
            type: "string",
            enum: ["pane", "window"],
            description: "What to create for the command: a pane (default) or a window",
          },
          place: {
            type: "string",
            enum: [...PANE_PLACES, ...WINDOW_PLACES],
            description: "Placement for the created pane or window, as tmux_new: pane bottom/top/right/left, window after/before",
          },
          focus: { type: "boolean", description: "Activate the created pane or window (default false)" },
          timeoutMs: { type: "integer", description: "How long to wait for the command before returning (default 800)" },
        },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as {
          command?: string
          new?: string
          place?: string
          focus?: boolean
          timeoutMs?: number
        }
        if (typeof args.command !== "string") return { content: "tmux_exec: command is required" }
        if (args.new !== undefined && args.new !== "pane" && args.new !== "window") {
          return { content: 'tmux_exec: new must be "pane" or "window"' }
        }
        const kind: NewKind = args.new === "window" ? "window" : "pane"
        const places: readonly string[] = kind === "pane" ? PANE_PLACES : WINDOW_PLACES
        if (args.place !== undefined && !places.includes(args.place)) {
          return { content: `tmux_exec: place for a ${kind} must be one of ${places.join(", ")}` }
        }

        // The command always runs in a pane of its own, split from the anchor
        // or placed in the anchor's session, so there is no target to pass.
        const base = target(undefined)
        if (!base) return { content: NO_TARGET }
        if (!(await confirmed(base))) return { content: staleTarget(base) }

        // The raw command is the resource, so the per-command shell rules still
        // govern what actually runs; tmux_exec is not a way around them.
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: SHELL_ACTION,
          resources: [args.command],
          save: [args.command],
        })

        // Create the pane or window with its shell, so a fast command cannot
        // destroy it before the option set and the respawn have run.
        let createArgv: string[]
        if (kind === "window") {
          const session = await sessionOf(base)
          if (!session) return { content: staleTarget(base) }
          createArgv = newArgv(session, { kind, place: args.place as WindowPlace | undefined, shell, focus: args.focus })
        } else {
          createArgv = newArgv(base, { kind, place: args.place as PanePlace | undefined, shell, focus: args.focus })
        }
        const created = await runner(createArgv)
        if (created.code !== 0) return failure(createArgv, created.message)
        const createdId = created.stdout.trim()
        if (!createdId) return { content: "tmux_exec: the new pane or window did not report an id" }

        // new-window reports a window id; the pane the command runs in is
        // resolved from it.
        const pane = kind === "window" ? await paneOf(createdId) : createdId
        if (!pane) {
          await runner(killArgv(kind, createdId))
          return { content: "tmux_exec: could not resolve the pane in the new window" }
        }

        // Keep the pane after the command exits so its output stays readable,
        // and suppress the dead-pane banner. The second option is best effort:
        // an older tmux may not know it, and the banner is stripped anyway.
        await runner(paneOptionArgv(pane, "remain-on-exit", "on"))
        await runner(paneOptionArgv(pane, "remain-on-exit-format", ""))

        // Run the command as the pane's own process; its output is the pane's
        // content, with no echoed command line and no prompt.
        const respawn = respawnArgv(pane, shell, args.command)
        const run = await runner(respawn)
        if (run.code !== 0) {
          await runner(killArgv(kind, createdId))
          return failure(respawn, run.message)
        }

        const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_EXEC_TIMEOUT_MS
        const dead = await waitForPaneDead(
          async () => {
            const res = await runner(paneDeadArgv(pane))
            return res.code === 0 ? res.stdout : "0"
          },
          { timeoutMs },
        )

        if (!dead) {
          // Still running: leave it alone, return what is capturable, and name
          // the pane so the caller can kill it or keep watching.
          const captured = await runner(captureArgv(pane, { start: "-" }))
          const text = captured.code === 0 ? cleanExecCapture(captured.stdout) : ""
          const body = text.length > 0 ? text : "(no output yet)"
          return { content: `${body}\n${execTimeoutTrailer(timeoutMs, pane)}` }
        }

        // Dead: read the exit status and the output, then close the pane or
        // window. The close runs even if a read fails, so nothing is orphaned.
        let exit: number | undefined
        let text = ""
        try {
          const status = await runner(paneDeadStatusArgv(pane))
          if (status.code === 0) {
            const code = Number.parseInt(status.stdout.trim(), 10)
            if (!Number.isNaN(code)) exit = code
          }
          const captured = await runner(captureArgv(pane, { start: "-" }))
          if (captured.code === 0) text = cleanExecCapture(captured.stdout)
        } finally {
          await runner(killArgv(kind, createdId))
        }

        const body = text.length > 0 ? text : "(no output)"
        return { content: `${body}\n${execTrailer(exit)}` }
      },
    })

    editor.add({
      name: "tmux_capture",
      description:
        "Read a pane's contents. Load the `tmux` skill first. Input: target, optional start, end, escapes. Waits for the pane to settle.",
      input: {
        type: "object",
        properties: {
          target: { type: "string", description: "Pane target; defaults to the agent pane" },
          start: { type: "string", description: "Start line, e.g. -20 for the last 20 lines of scrollback" },
          end: { type: "string", description: "End line" },
          escapes: { type: "boolean", description: "Include ANSI escape sequences" },
        },
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = raw as { target?: string; start?: string; end?: string; escapes?: boolean }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
        const argv = captureArgv(resolved, { start: args.start, end: args.end, escapes: args.escapes })
        const captured = await settleCapture(async () => {
          const res = await runner(argv)
          return res.code === 0 ? res.stdout : `tmux capture-pane failed: ${res.message}`
        })
        const text = captured.replace(/\s+$/, "")
        return { content: text.length > 0 ? text : "(pane is empty)" }
      },
    })

    editor.add({
      name: "tmux_edit",
      description:
        "Open the user's editor on a file or folder in a new tmux pane or window. Use it only when the user explicitly asks to edit a file. Load the `tmux` skill first; the `tmux-editor` skill covers it. Input: path, optional placement (right|left|window), focus (default true), target.",
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to open" },
          placement: {
            type: "string",
            enum: ["right", "left", "window"],
            description: "right (default), left, or window",
          },
          focus: { type: "boolean", description: "Focus the new pane or window (default true)" },
          target: {
            type: "string",
            description: "Pane to split, or session anchor for a window; defaults to the agent pane",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as { path?: string; placement?: string; focus?: boolean; target?: string }
        if (!args.path) return { content: "tmux_edit: path is required" }
        const placement = args.placement ?? "right"
        if (placement !== "right" && placement !== "left" && placement !== "window") {
          return { content: 'tmux_edit: placement must be "right", "left", or "window"' }
        }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
        if (!resolvedEditor.command) {
          return {
            content:
              "tmux_edit: no editor found; set the plugin `editor` option, set $EDITOR, or install vim or nano",
          }
        }
        const invocation = editorInvocation({
          editor: resolvedEditor.command,
          path: args.path,
          isDirectory: isDirectory(args.path),
          nerdtree,
        })
        if (!invocation.command) {
          return { content: `tmux_edit: ${invocation.error ?? "cannot open this path"}` }
        }
        const command = invocation.command
        const focus = args.focus !== false
        // The editor command itself is version-specific; gate on a stable,
        // namespaced resource so one rule (`tmux_edit *`) covers every editor.
        const resource = `tmux_edit ${args.path}`
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: SHELL_ACTION,
          resources: [resource],
          save: [resource],
        })

        if (placement === "window") {
          const session = await sessionOf(resolved)
          if (!session) return { content: staleTarget(resolved) }
          const argv = newArgv(session, { kind: "window", command, shell, focus })
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
          const id = res.stdout.trim()
          // The editor sets the terminal title, so turn the window's own rename
          // off before naming it, or the name is gone once the editor starts.
          for (const call of nameSequence("window", id, basename(args.path))) {
            const named = await runner(call)
            if (named.code !== 0) return failure(call, named.message)
          }
          return { content: editSummary(resolvedEditor.command, args.path, "window", invocation.nerdtree, id) }
        }

        const argv = newArgv(resolved, { kind: "pane", place: placement as PanePlace, command, shell, focus })
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        return { content: editSummary(resolvedEditor.command, args.path, placement, invocation.nerdtree, res.stdout.trim()) }
      },
    })
  })
}
