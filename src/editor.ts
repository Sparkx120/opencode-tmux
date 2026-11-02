// Editor resolution and the command `tmux_edit` runs. Resolution order, the
// invocation builder, and quoting are pure; the PATH lookup and the NERDTree
// probe are the only pieces that touch the outside world, and both are
// injectable so tests need no editor installed.

import { execFile } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { basename, delimiter, join } from "node:path"

export const FALLBACK_EDITORS = ["vim", "nano"] as const

export type EditorSource = "option" | "env" | "fallback" | "none"

export interface ResolvedEditor {
  command?: string
  source: EditorSource
}

export interface ResolveEditorInput {
  option?: string
  env?: NodeJS.ProcessEnv
  /** Availability check for the fallback editors; defaults to a PATH lookup. */
  available?: (name: string) => boolean
}

// A name is available when it is an executable on PATH. Empty path entries fall
// through, so an unset PATH resolves nothing.
export function onPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue
    try {
      accessSync(join(dir, name), constants.X_OK)
      return true
    } catch {
      // keep looking
    }
  }
  return false
}

// The plugin option wins, then $EDITOR, then the first fallback editor found on
// PATH. An unset fallback set yields no editor, which the tool reports.
export function resolveEditor(input: ResolveEditorInput = {}): ResolvedEditor {
  const env = input.env ?? process.env
  if (input.option) return { command: input.option, source: "option" }
  if (env.EDITOR) return { command: env.EDITOR, source: "env" }
  const available = input.available ?? ((name: string) => onPath(name, env))
  for (const candidate of FALLBACK_EDITORS) {
    if (available(candidate)) return { command: candidate, source: "fallback" }
  }
  return { source: "none" }
}

export function isVimFamily(editor: string): boolean {
  const name = basename(editor)
  return name === "vim" || name === "nvim"
}

export function isNano(editor: string): boolean {
  return basename(editor) === "nano"
}

// `-N` (nocompatible) is essential: plain `-es` starts vi-compatible and skips
// packages, so NERDTree would never be found even when installed. `-es` runs ex
// silently; `cquit` exits non-zero when the command is missing.
export const NERD_TREE_PROBE_ARGS = [
  "-N",
  "-es",
  "-c",
  'if !exists(":NERDTree") | cquit | endif',
  "-c",
  "qall!",
]

export type EditorExec = (file: string, args: string[]) => Promise<number>

// Runs the editor once in ex mode; exit 0 means the NERDTree command exists.
export const probeNerdTree: EditorExec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { env: process.env }, (error) => {
      if (error) {
        const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1
        resolve(code)
        return
      }
      resolve(0)
    })
  })

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface EditorInvocationInput {
  editor: string
  path: string
  isDirectory: boolean
  nerdtree: boolean
}

export interface EditorInvocation {
  command?: string
  error?: string
  nerdtree: boolean
}

// The pane command, `exec`-prefixed so the shell is replaced and the pane lives
// as long as the editor. A directory opened with a vim-family editor uses
// NERDTree when present, falls back to the editor's own directory view
// otherwise, and is refused for nano, which cannot browse a folder.
export function editorInvocation(input: EditorInvocationInput): EditorInvocation {
  const { editor, path, isDirectory } = input
  if (isDirectory) {
    if (isVimFamily(editor)) {
      if (input.nerdtree) {
        return { command: `exec ${shellQuote(editor)} -c ${shellQuote(`NERDTree ${path}`)}`, nerdtree: true }
      }
      return { command: `exec ${shellQuote(editor)} ${shellQuote(path)}`, nerdtree: false }
    }
    if (isNano(editor)) {
      return { error: `${editor} cannot browse a folder; open a file, or use an editor that can`, nerdtree: false }
    }
    return { command: `exec ${shellQuote(editor)} ${shellQuote(path)}`, nerdtree: false }
  }
  return { command: `exec ${shellQuote(editor)} ${shellQuote(path)}`, nerdtree: false }
}
