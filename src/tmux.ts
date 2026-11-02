// tmux argument builders plus a thin runner. The builders are pure (plain
// values in, argv arrays out) so they unit-test with no tmux present; run()
// is the only piece that shells out, and it never throws — a non-zero exit
// comes back as a message field the caller returns to the model as text.

import { execFile } from "node:child_process"

// Fields the skill documents: the session:window.pane address, the pane and
// window ids, the pane title and the running command.
export const CONTEXT_FORMAT =
  "#{session_name}:#{window_index}.#{pane_index} pane_id=#{pane_id} title=#{pane_title} cmd=#{pane_current_command}"

export interface RunResult {
  stdout: string
  stderr: string
  code: number
  /** Non-zero exit surfaced as a message; empty on success. */
  message: string
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv
}

export type Runner = (argv: string[], opts?: RunOptions) => Promise<RunResult>

export function run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile("tmux", argv, { env: opts.env ?? process.env }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1
        const message = (stderr || error.message || "").trim()
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, message })
        return
      }
      resolve({ stdout, stderr, code: 0, message: "" })
    })
  })
}

// Agent pane plus every pane. Without a target the agent-pane command is
// dropped; the pane list still answers.
export function contextArgv(target: string | undefined): string[][] {
  const argv: string[][] = []
  if (target) argv.push(["display-message", "-p", "-t", target, "-F", CONTEXT_FORMAT])
  argv.push(["list-panes", "-a", "-F", CONTEXT_FORMAT])
  return argv
}

export function nameArgv(kind: "pane" | "window", target: string, name: string): string[] {
  return kind === "pane" ? ["select-pane", "-t", target, "-T", name] : ["rename-window", "-t", target, name]
}

export const DEFAULT_SHELL = "sh"

export interface NewPaneOptions {
  /** true splits below (tmux -v), false splits to the side (-h). Defaults true. */
  vertical?: boolean
  command?: string
  /** Shell used to run `command` as `<shell> -c command`. Defaults to "sh". */
  shell?: string
}

// split-window has no pane-name flag: the caller names the pane afterwards
// with select-pane -T against the returned id. A command is wrapped in a shell
// so pipes, redirects, &&, and globs reach the pane intact.
export function newPaneArgv(target: string, opts: NewPaneOptions = {}): string[] {
  const argv = ["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", target, opts.vertical === false ? "-h" : "-v"]
  if (opts.command) argv.push(opts.shell ?? DEFAULT_SHELL, "-c", opts.command)
  return argv
}

export interface NewWindowOptions {
  name?: string
  command?: string
  /** Shell used to run `command` as `<shell> -c command`. Defaults to "sh". */
  shell?: string
}

// `target` must be a session (e.g. `$3:`), not a pane or window: tmux 3.8
// rejects a pane here ("can't specify pane here") and a bare window id tries to
// reuse a window index. The caller resolves the session first.
export function newWindowArgv(target: string, opts: NewWindowOptions = {}): string[] {
  const argv = ["new-window", "-d", "-P", "-F", "#{window_id}", "-t", target]
  if (opts.name) argv.push("-n", opts.name)
  if (opts.command) argv.push(opts.shell ?? DEFAULT_SHELL, "-c", opts.command)
  return argv
}

export interface SendOptions {
  /** Default true: -l sends the text verbatim instead of as key names. */
  literal?: boolean
  /** Default true: a separate Enter keypress after the text. */
  enter?: boolean
}

// Two commands: the text, then Enter. Keeping them separate means multi-line
// or special-character text never gets parsed as a key name. `--` terminates
// the flags so literal text starting with `-` is not read as an option.
export function sendKeysArgv(target: string, text: string, opts: SendOptions = {}): string[][] {
  const literal = opts.literal !== false
  const enter = opts.enter !== false
  const first = literal
    ? ["send-keys", "-t", target, "-l", "--", text]
    : ["send-keys", "-t", target, "--", text]
  const argv = [first]
  if (enter) argv.push(["send-keys", "-t", target, "Enter"])
  return argv
}

// Probes a target for existence: a non-zero exit or empty stdout means the
// target is gone (e.g. a stale $TMUX_PANE inherited by the daemon).
export function targetExistsArgv(target: string): string[] {
  return ["display-message", "-p", "-t", target, "-F", "#{pane_id}"]
}

export function sessionForArgv(target: string): string[] {
  return ["display-message", "-p", "-t", target, "-F", "#{session_id}:"]
}

export interface CaptureOptions {
  start?: string
  end?: string
  escapes?: boolean
}

export function captureArgv(target: string, opts: CaptureOptions = {}): string[] {
  const argv = ["capture-pane", "-p", "-t", target]
  if (opts.start !== undefined) argv.push("-S", opts.start)
  if (opts.end !== undefined) argv.push("-E", opts.end)
  if (opts.escapes) argv.push("-e")
  return argv
}

export interface SettleOptions {
  timeoutMs?: number
  pollMs?: number
}

// Capture output lags the redraw: poll until two consecutive reads match, or
// the deadline passes, then return the last read. No dependencies; the small
// defaults keep a tool call responsive.
export async function settleCapture(
  read: () => Promise<string>,
  opts: SettleOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 800
  const pollMs = opts.pollMs ?? 50
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const deadline = Date.now() + timeoutMs
  let prev = await read()
  for (;;) {
    if (Date.now() >= deadline) return prev
    await wait(pollMs)
    const next = await read()
    if (next === prev) return next
    prev = next
  }
}
