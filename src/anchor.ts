// Per-session anchor resolution. The `opencode serve` daemon is long-lived and
// shared by every TUI, so the TMUX_PANE it inherited belongs to whichever pane
// launched the daemon, not to the calling session. Prefer a pane whose current
// path matches the session's location directory.

import { realpathSync } from "node:fs"
import { homedir } from "node:os"

export const PANE_LIST_FORMAT = "#{pane_id}\t#{pane_current_command}\t#{pane_current_path}"

export function listPanesArgv(): string[] {
  return ["list-panes", "-a", "-F", PANE_LIST_FORMAT]
}

export interface PaneRow {
  id: string
  command: string
  path: string
}

// The path is the last field, so a tab inside it survives: split on the first
// two tabs only. A tab inside the command (a short name like `opencode` or
// `bash` in practice) would still shift the fields, which is why the command
// is not the field of interest.
export function parsePaneRows(stdout: string): PaneRow[] {
  const rows: PaneRow[] = []
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue
    const first = line.indexOf("\t")
    if (first < 0) continue
    const second = line.indexOf("\t", first + 1)
    if (second < 0) continue
    rows.push({
      id: line.slice(0, first),
      command: line.slice(first + 1, second),
      path: line.slice(second + 1),
    })
  }
  return rows
}

// realpath collapses symlinks and trailing slashes; `~` is expanded first. A
// path that does not exist falls back to a slash-trimmed form so two spellings
// of the same missing path still compare equal.
export function normalizePath(path: string): string {
  let expanded = path
  if (expanded === "~") expanded = homedir()
  else if (expanded.startsWith("~/")) expanded = homedir() + expanded.slice(1)
  try {
    return realpathSync(expanded)
  } catch {
    return expanded.replace(/\/+$/, "") || "/"
  }
}

export type AnchorSource = "explicit" | "option" | "directory" | "env" | "none"

export interface AnchorInput {
  explicit?: string
  option?: string
  rows: readonly PaneRow[]
  directory?: string
  env?: NodeJS.ProcessEnv
  normalize?: (path: string) => string
}

export interface Anchor {
  target?: string
  source: AnchorSource
}

const OPENCODE_COMMAND = "opencode"

// The unique pane whose current path matches the directory. Several matches are
// only resolvable when exactly one runs the opencode TUI; anything else is
// ambiguous and returns undefined so the caller falls back rather than guesses.
function directoryMatch(
  rows: readonly PaneRow[],
  directory: string | undefined,
  normalize: (path: string) => string,
): PaneRow | undefined {
  if (!directory) return undefined
  const wanted = normalize(directory)
  const matches = rows.filter((row) => normalize(row.path) === wanted)
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  const opencode = matches.filter((row) => row.command === OPENCODE_COMMAND)
  return opencode.length === 1 ? opencode[0] : undefined
}

// Precedence, highest first: explicit target, plugin `pane` option, directory
// match, $TMUX_PANE. The option sits above the heuristic so a pinned pane is
// never second-guessed; the heuristic sits above the env so a shared daemon's
// stale TMUX_PANE does not win.
export function chooseAnchor(input: AnchorInput): Anchor {
  const normalize = input.normalize ?? normalizePath
  if (input.explicit) return { target: input.explicit, source: "explicit" }
  if (input.option) return { target: input.option, source: "option" }
  const match = directoryMatch(input.rows, input.directory, normalize)
  if (match) return { target: match.id, source: "directory" }
  const envPane = input.env?.TMUX_PANE
  if (envPane) return { target: envPane, source: "env" }
  return { target: undefined, source: "none" }
}
