// The six lean tmux tools. Each execute gets the raw JSON-schema args (cast)
// and returns { content: <string> } to the model; a missing target or a tmux
// error becomes a text message, never a thrown error. The runner and env are
// injectable so tests exercise the glue without touching a real tmux server.

import type { Plugin } from "@opencode/plugin"
import {
  captureArgv,
  contextArgv,
  DEFAULT_SHELL,
  nameArgv,
  newPaneArgv,
  newWindowArgv,
  resolveTarget,
  run as defaultRun,
  sendKeysArgv,
  sessionForArgv,
  settleCapture,
  targetExistsArgv,
} from "./tmux.js"
import type { Runner } from "./tmux.js"

const NO_TARGET =
  "no tmux target available: pass a target, set the plugin `pane` option, or run inside tmux with $TMUX_PANE set"

// The action name OpenCode's own shell tool uses (packages/core tool/plugin/shell.ts
// sets `action: name` with `name = "shell"`), so the same permission rules apply.
const SHELL_ACTION = "shell"

function staleTarget(target: string): string {
  return `tmux target "${target}" does not exist (stale $TMUX_PANE?); pass a target or set the plugin \`pane\` option`
}

function paneOption(ctx: Plugin.Context): string | undefined {
  const value = ctx.options.pane
  return typeof value === "string" ? value : undefined
}

function shellOption(ctx: Plugin.Context): string {
  const value = ctx.options.shell
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_SHELL
}

function failure(argv: string[], message: string): { content: string } {
  return { content: `tmux ${argv[0]} failed: ${message}` }
}

export async function registerTools(
  ctx: Plugin.Context,
  runner: Runner = defaultRun,
  env: NodeJS.ProcessEnv = process.env,
) {
  const pane = paneOption(ctx)
  const shell = shellOption(ctx)
  const target = (explicit?: string) => resolveTarget(explicit, pane, env)

  // The resolved target can be a stale $TMUX_PANE the daemon inherited. Probe
  // it before acting so a dead anchor fails clearly instead of with a raw tmux
  // error.
  const confirmed = async (resolved: string): Promise<boolean> => {
    const res = await runner(targetExistsArgv(resolved))
    return res.code === 0 && res.stdout.trim() !== ""
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
        const anchor = target(undefined)
        const chunks: string[] = []
        let anchorOk = false
        if (anchor && (await confirmed(anchor))) {
          anchorOk = true
        }
        for (const argv of contextArgv(anchorOk ? anchor : undefined)) {
          const res = await runner(argv)
          if (res.code !== 0) return failure(argv, res.message)
          chunks.push(res.stdout.trimEnd())
        }
        if (!anchor) {
          chunks.unshift(
            "No agent pane available (set $TMUX_PANE or the plugin `pane` option); listing all panes.",
          )
        } else if (!anchorOk) {
          chunks.unshift(
            `Anchor pane ${anchor} is unavailable (stale $TMUX_PANE?); listing all panes instead.`,
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
        const argv = nameArgv(args.kind, resolved, args.name)
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        return { content: `named ${args.kind} ${resolved} as ${args.name}` }
      },
    })

    editor.add({
      name: "tmux_new_pane",
      description:
        "Create a pane. Load the `tmux` skill first. Input: optional target, name, command, vertical. Returns the new pane id.",
      input: {
        type: "object",
        properties: {
          target: { type: "string", description: "Pane to split; defaults to the agent pane" },
          name: { type: "string", description: "Pane title to set after creation" },
          command: { type: "string", description: "Shell command to run in the new pane" },
          vertical: { type: "boolean", description: "true splits below (default), false splits to the side" },
        },
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as { target?: string; name?: string; command?: string; vertical?: boolean }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
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
        const argv = newPaneArgv(resolved, { vertical: args.vertical, command: args.command, shell })
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        const id = res.stdout.trim()
        if (args.name) {
          const nameArgvFull = nameArgv("pane", id, args.name)
          const nameRes = await runner(nameArgvFull)
          if (nameRes.code !== 0) return failure(nameArgvFull, nameRes.message)
        }
        return { content: `created pane ${id}${args.name ? ` named ${args.name}` : ""}` }
      },
    })

    editor.add({
      name: "tmux_new_window",
      description:
        "Create a window in the agent's session. Load the `tmux` skill first. Input: optional target, name, command. Returns the new window id.",
      input: {
        type: "object",
        properties: {
          target: { type: "string", description: "Session or window to anchor the new window; defaults to the agent pane" },
          name: { type: "string", description: "Window name" },
          command: { type: "string", description: "Shell command to run in the new window" },
        },
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = raw as { target?: string; name?: string; command?: string }
        const resolved = target(args.target)
        if (!resolved) return { content: NO_TARGET }
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
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
        const argv = newWindowArgv(session, { name: args.name, command: args.command, shell })
        const res = await runner(argv)
        if (res.code !== 0) return failure(argv, res.message)
        const id = res.stdout.trim()
        return { content: `created window ${id}${args.name ? ` named ${args.name}` : ""}` }
      },
    })

    editor.add({
      name: "tmux_send",
      description:
        "Send text or a command to a pane. Load the `tmux` skill first. Input: text, optional target (defaults to the agent pane), literal (default true), enter (default true).",
      input: {
        type: "object",
        properties: {
          target: { type: "string", description: "Pane target; defaults to the agent pane" },
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
        if (!(await confirmed(resolved))) return { content: staleTarget(resolved) }
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
  })
}
