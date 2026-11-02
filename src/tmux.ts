// tmux argument builders plus a thin runner. The builders are pure (plain
// values in, argv arrays out) so they unit-test with no tmux present; run()
// is the only piece that shells out, and it never throws — a non-zero exit
// comes back as a message field the caller returns to the model as text.

import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"

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

export type NewKind = "pane" | "window"

export const PANE_PLACES = ["bottom", "top", "right", "left"] as const
export const WINDOW_PLACES = ["after", "before"] as const
export type PanePlace = (typeof PANE_PLACES)[number]
export type WindowPlace = (typeof WINDOW_PLACES)[number]

// `-v` splits above/below, `-h` splits left/right; `-b` places the new pane
// above or to the left of the target instead of below or to the right.
function panePlaceFlags(place: PanePlace | undefined): string[] {
  switch (place ?? "bottom") {
    case "top":
      return ["-v", "-b"]
    case "right":
      return ["-h"]
    case "left":
      return ["-h", "-b"]
    default:
      return ["-v"]
  }
}

// `-a` inserts the window after the target window, `-b` before it. tmux's
// no-flag default appends at the end, so `after` must pass `-a` explicitly.
function windowPlaceFlags(place: WindowPlace | undefined): string[] {
  return place === "before" ? ["-b"] : ["-a"]
}

export interface NewArgvOptions {
  kind: NewKind
  place?: PanePlace | WindowPlace
  /** Pane only, passed to `-l`: tmux's own forms (`20`, `30%`). */
  size?: string
  name?: string
  command?: string
  /** Shell used to run `command` as `<shell> -c command`. Defaults to "sh". */
  shell?: string
  /** Default false (detached); true activates the new pane or window. */
  focus?: boolean
}

// One builder for both kinds. split-window has no pane-name flag: the caller
// names the pane afterwards with select-pane -T against the returned id.
export function newArgv(target: string, opts: NewArgvOptions): string[] {
  const detached = opts.focus === true ? [] : ["-d"]
  const shell = opts.shell ?? DEFAULT_SHELL
  if (opts.kind === "pane") {
    const argv = [
      "split-window",
      ...detached,
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      target,
      ...panePlaceFlags(opts.place as PanePlace | undefined),
    ]
    if (opts.size) argv.push("-l", opts.size)
    if (opts.command) argv.push(shell, "-c", opts.command)
    return argv
  }
  // `target` must be a session (e.g. `$3:`): tmux 3.8 rejects a pane here
  // ("can't specify pane here"). The caller resolves the session first.
  const argv = [
    "new-window",
    ...detached,
    "-P",
    "-F",
    "#{window_id}",
    "-t",
    target,
    ...windowPlaceFlags(opts.place as WindowPlace | undefined),
  ]
  if (opts.name) argv.push("-n", opts.name)
  if (opts.command) argv.push(shell, "-c", opts.command)
  return argv
}

export function killArgv(kind: NewKind, target: string): string[] {
  return [kind === "pane" ? "kill-pane" : "kill-window", "-t", target]
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

// Per-call unique, shell-safe sentinel stem for tmux_exec. Alphanumerics only,
// so it needs no quoting and cannot collide with the pane's older content.
export function execMarker(): string {
  return `OCE${randomUUID().replace(/-/g, "").slice(0, 12)}`
}

// One line that brackets the command with a begin marker and an end marker
// carrying the exit status, so the output can be sliced out of the capture.
export function bracketedCommand(command: string, marker: string): string {
  return `echo ${marker}-B; ${command}; echo "${marker}-E:$?"`
}

export interface ExecExtract {
  /** The command's output, or the raw capture when the markers were not found. */
  text: string
  /** Exit status from the end marker; undefined when absent or unparseable. */
  exit?: number
  /** false when the markers were missing and the text is the raw capture. */
  bounded: boolean
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === "") start++
  while (end > start && lines[end - 1]!.trim() === "") end--
  return lines.slice(start, end)
}

// Slice the output from the last begin marker to the first end marker after it,
// so a pane holding earlier runs still resolves to the current one. When either
// marker is missing, the caller gets the raw capture plus bounded: false, so it
// can report the boundary failure instead of silently returning partial output.
export function extractExecOutput(capture: string, marker: string): ExecExtract {
  const lines = capture.split("\n")
  const beginMarker = `${marker}-B`
  const endMarker = `${marker}-E:`

  let begin = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(beginMarker)) {
      begin = i
      break
    }
  }
  if (begin < 0) return { text: capture.replace(/\s+$/, ""), bounded: false }

  for (let i = begin + 1; i < lines.length; i++) {
    const at = lines[i]!.indexOf(endMarker)
    if (at < 0) continue
    const code = Number.parseInt(lines[i]!.slice(at + endMarker.length).trim(), 10)
    const exit = Number.isNaN(code) ? undefined : code
    return { text: trimBlankLines(lines.slice(begin + 1, i)).join("\n"), exit, bounded: true }
  }

  return { text: capture.replace(/\s+$/, ""), bounded: false }
}

export function sessionForArgv(target: string): string[] {
  return ["display-message", "-p", "-t", target, "-F", "#{session_id}:"]
}

// The window that contains a target pane (or the target window itself).
export function windowForArgv(target: string): string[] {
  return ["display-message", "-p", "-t", target, "-F", "#{window_id}"]
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

export interface ExecWaitOptions {
  timeoutMs?: number
  pollMs?: number
}

// Poll until extractExecOutput reports a bounded result, i.e. the end marker is
// present. A stable capture is deliberately NOT the signal: on a fresh pane the
// capture can be momentarily unchanged between the key send and the first
// output, so two equal reads would return before the command had run. On
// timeout the last extract is returned, bounded or not.
export async function waitForExecOutput(
  read: () => Promise<string>,
  marker: string,
  opts: ExecWaitOptions = {},
): Promise<ExecExtract> {
  const timeoutMs = opts.timeoutMs ?? 800
  const pollMs = opts.pollMs ?? 50
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const deadline = Date.now() + timeoutMs
  let extracted = extractExecOutput(await read(), marker)
  while (!extracted.bounded) {
    if (Date.now() >= deadline) return extracted
    await wait(pollMs)
    extracted = extractExecOutput(await read(), marker)
  }
  return extracted
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
