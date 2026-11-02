import { describe, expect, test } from "bun:test"
import {
  editorInvocation,
  isNano,
  isVimFamily,
  NERD_TREE_PROBE_ARGS,
  resolveEditor,
  shellQuote,
} from "../src/editor.js"

describe("resolveEditor", () => {
  test("the plugin option wins over $EDITOR", () => {
    expect(resolveEditor({ option: "code", env: { EDITOR: "vim" } as NodeJS.ProcessEnv })).toEqual({
      command: "code",
      source: "option",
    })
  })

  test("$EDITOR is next", () => {
    expect(resolveEditor({ env: { EDITOR: "emacs" } as NodeJS.ProcessEnv })).toEqual({
      command: "emacs",
      source: "env",
    })
  })

  test("falls back to vim when available", () => {
    expect(resolveEditor({ env: {} as NodeJS.ProcessEnv, available: (n) => n === "vim" })).toEqual({
      command: "vim",
      source: "fallback",
    })
  })

  test("falls back to nano when only nano is available", () => {
    expect(resolveEditor({ env: {} as NodeJS.ProcessEnv, available: (n) => n === "nano" })).toEqual({
      command: "nano",
      source: "fallback",
    })
  })

  test("none when nothing resolves", () => {
    expect(resolveEditor({ env: {} as NodeJS.ProcessEnv, available: () => false })).toEqual({ source: "none" })
  })

  test("empty option and empty $EDITOR fall through", () => {
    expect(
      resolveEditor({ option: "", env: { EDITOR: "" } as NodeJS.ProcessEnv, available: () => false }),
    ).toEqual({ source: "none" })
  })
})

describe("editor family", () => {
  test("vim and nvim are vim-family", () => {
    expect(isVimFamily("vim")).toBe(true)
    expect(isVimFamily("/usr/bin/vim")).toBe(true)
    expect(isVimFamily("/usr/bin/nvim")).toBe(true)
    expect(isVimFamily("nano")).toBe(false)
  })

  test("nano detection uses the basename", () => {
    expect(isNano("/usr/bin/nano")).toBe(true)
    expect(isNano("vim")).toBe(false)
  })

  test("family detection sees through the editor's own arguments", () => {
    expect(isVimFamily("vim -f")).toBe(true)
    expect(isVimFamily("/usr/bin/nvim --clean")).toBe(true)
    expect(isNano("nano -w")).toBe(true)
    expect(isVimFamily("code --wait")).toBe(false)
  })
})

describe("shellQuote", () => {
  test("wraps in single quotes and escapes embedded ones", () => {
    expect(shellQuote("/a b")).toBe("'/a b'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe("editorInvocation", () => {
  test("vim on a directory with NERDTree runs the NERDTree command", () => {
    expect(editorInvocation({ editor: "vim", path: "/tmp/proj", isDirectory: true, nerdtree: true })).toEqual({
      command: "exec vim -c 'NERDTree /tmp/proj'",
      nerdtree: true,
    })
  })

  test("vim on a directory without NERDTree opens the directory", () => {
    expect(editorInvocation({ editor: "vim", path: "/tmp/proj", isDirectory: true, nerdtree: false })).toEqual({
      command: "exec vim '/tmp/proj'",
      nerdtree: false,
    })
  })

  test("vim on a file ignores NERDTree", () => {
    expect(editorInvocation({ editor: "vim", path: "/tmp/f.txt", isDirectory: false, nerdtree: true })).toEqual({
      command: "exec vim '/tmp/f.txt'",
      nerdtree: false,
    })
  })

  test("an editor carrying its own arguments is interpolated unquoted", () => {
    expect(
      editorInvocation({ editor: "vim -f", path: "/tmp/f.txt", isDirectory: false, nerdtree: false }).command,
    ).toBe("exec vim -f '/tmp/f.txt'")
    expect(
      editorInvocation({ editor: "code --wait", path: "/tmp/f.txt", isDirectory: false, nerdtree: false }).command,
    ).toBe("exec code --wait '/tmp/f.txt'")
    expect(
      editorInvocation({ editor: "emacsclient -nw", path: "/tmp/f.txt", isDirectory: false, nerdtree: false }).command,
    ).toBe("exec emacsclient -nw '/tmp/f.txt'")
  })

  test("an editor carrying its own arguments still gets the path quoted", () => {
    expect(
      editorInvocation({ editor: "vim -f", path: "/tmp/a b", isDirectory: false, nerdtree: false }).command,
    ).toBe("exec vim -f '/tmp/a b'")
  })

  test("nvim on a directory uses NERDTree too", () => {
    expect(
      editorInvocation({ editor: "/usr/bin/nvim", path: "/tmp/proj", isDirectory: true, nerdtree: true }).command,
    ).toBe("exec /usr/bin/nvim -c 'NERDTree /tmp/proj'")
  })

  test("an editor with arguments still reaches NERDTree", () => {
    expect(
      editorInvocation({ editor: "vim -f", path: "/tmp/proj", isDirectory: true, nerdtree: true }).command,
    ).toBe("exec vim -f -c 'NERDTree /tmp/proj'")
  })

  test("nano on a directory reports that it cannot browse a folder", () => {
    const out = editorInvocation({ editor: "nano", path: "/tmp/proj", isDirectory: true, nerdtree: false })
    expect(out.command).toBeUndefined()
    expect(out.error).toContain("folder")
  })

  test("a path with spaces stays quoted", () => {
    expect(
      editorInvocation({ editor: "vim", path: "/tmp/a b", isDirectory: false, nerdtree: false }).command,
    ).toBe("exec vim '/tmp/a b'")
  })

  test("a path with a quote is safely quoted", () => {
    expect(editorInvocation({ editor: "vim", path: "/tmp/it's", isDirectory: false, nerdtree: false }).command).toBe(
      "exec vim '/tmp/it'\\''s'",
    )
  })

  test("the probe runs vim nocompatible in ex mode and checks for NERDTree", () => {
    // -N is required so packages load; plain -es skips them.
    expect(NERD_TREE_PROBE_ARGS).toContain("-N")
    expect(NERD_TREE_PROBE_ARGS).toContain("-es")
    expect(NERD_TREE_PROBE_ARGS.join(" ")).toContain("NERDTree")
  })
})
