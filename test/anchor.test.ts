import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  chooseAnchor,
  listPanesArgv,
  normalizePath,
  PANE_LIST_FORMAT,
  parsePaneRows,
  type PaneRow,
} from "../src/anchor.js"

const row = (id: string, command: string, path: string): PaneRow => ({ id, command, path })

describe("listPanesArgv", () => {
  test("lists every pane with id, command, and path", () => {
    expect(listPanesArgv()).toEqual(["list-panes", "-a", "-F", PANE_LIST_FORMAT])
    expect(PANE_LIST_FORMAT).toBe("#{pane_id}\t#{pane_current_command}\t#{pane_current_path}")
  })
})

describe("parsePaneRows", () => {
  test("parses tab-separated rows and ignores blank lines", () => {
    const stdout = "%1\topencode\t/repo-a\n%10\tbash\t/repo-b\n\n"
    expect(parsePaneRows(stdout)).toEqual([row("%1", "opencode", "/repo-a"), row("%10", "bash", "/repo-b")])
  })

  test("keeps tabs inside the path (the last field)", () => {
    const stdout = "%7\tbash\t/repo\twith\ttab\n"
    expect(parsePaneRows(stdout)).toEqual([row("%7", "bash", "/repo\twith\ttab")])
  })

  test("skips lines missing a second tab", () => {
    expect(parsePaneRows("%1\topencode\n%7\tbash\t/repo\n")).toEqual([row("%7", "bash", "/repo")])
  })

  test("an empty pane list parses to nothing", () => {
    expect(parsePaneRows("")).toEqual([])
  })
})

describe("chooseAnchor", () => {
  const match = [row("%10", "opencode", "/repo"), row("%1", "opencode", "/other")]

  test("explicit target beats everything", () => {
    const out = chooseAnchor({
      explicit: "%1",
      option: "%2",
      rows: match,
      directory: "/repo",
      env: { TMUX_PANE: "%3" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%1", source: "explicit" })
  })

  test("the pane option beats a path match", () => {
    const out = chooseAnchor({
      option: "%2",
      rows: match,
      directory: "/repo",
      env: { TMUX_PANE: "%3" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%2", source: "option" })
  })

  test("a unique path match wins over the environment", () => {
    const out = chooseAnchor({
      rows: match,
      directory: "/repo",
      env: { TMUX_PANE: "%1" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%10", source: "directory" })
  })

  test("a non-opencode command is chosen when it is the only path match", () => {
    const out = chooseAnchor({
      rows: [row("%5", "bash", "/repo")],
      directory: "/repo",
      env: { TMUX_PANE: "%1" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%5", source: "directory" })
  })

  test("two matches resolve to the opencode one", () => {
    const out = chooseAnchor({
      rows: [row("%5", "bash", "/repo"), row("%10", "opencode", "/repo")],
      directory: "/repo",
      env: { TMUX_PANE: "%1" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%10", source: "directory" })
  })

  test("two equally-good matches fall back to the environment", () => {
    const out = chooseAnchor({
      rows: [row("%5", "opencode", "/repo"), row("%10", "opencode", "/repo")],
      directory: "/repo",
      env: { TMUX_PANE: "%1" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%1", source: "env" })
  })

  test("no path match falls back to the environment", () => {
    const out = chooseAnchor({
      rows: [row("%5", "opencode", "/elsewhere")],
      directory: "/repo",
      env: { TMUX_PANE: "%1" } as NodeJS.ProcessEnv,
    })
    expect(out).toEqual({ target: "%1", source: "env" })
  })

  test("no match and empty env yields no target", () => {
    const out = chooseAnchor({ rows: [], directory: "/repo", env: {} as NodeJS.ProcessEnv })
    expect(out).toEqual({ target: undefined, source: "none" })
  })

  test("empty option and empty env fall through to none", () => {
    const out = chooseAnchor({ option: "", rows: [], env: { TMUX_PANE: "" } as NodeJS.ProcessEnv })
    expect(out).toEqual({ target: undefined, source: "none" })
  })

  test("normalizes the directory and pane paths before comparing", () => {
    const out = chooseAnchor({
      rows: [row("%10", "opencode", "/repo/")],
      directory: "/repo",
      env: {} as NodeJS.ProcessEnv,
      normalize: (p) => p.replace(/\/+$/, ""),
    })
    expect(out).toEqual({ target: "%10", source: "directory" })
  })
})

describe("normalizePath", () => {
  test("expands ~ to the home directory", () => {
    expect(normalizePath("~")).toBe(realpathSync(homedir()))
  })

  test("resolves a symlink to its target", () => {
    const base = mkdtempSync(join(tmpdir(), "anchor-"))
    const real = join(base, "real")
    const link = join(base, "link")
    try {
      mkdirSync(real)
      symlinkSync(real, link)
      expect(normalizePath(link)).toBe(normalizePath(real))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("strips a trailing slash from a non-existent path", () => {
    expect(normalizePath("/no/such/path/")).toBe("/no/such/path")
  })
})
