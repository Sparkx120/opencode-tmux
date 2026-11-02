# Release notes schema

Every GitHub release for this plugin uses the structure below. Read this file before
posting a release, and follow the sections in the order given. Write the body from the
commits since the previous tag rather than from memory.

## Tag and title

- Tag: an annotated tag named `v<version>`, where `<version>` matches the `version` field
  in `package.json`.
- Title: `v<version>`, optionally followed by a short name for the release.

## Sections

Include every section below, in this order. Keep a section even when it has nothing in it,
so a reader can tell "nothing changed" from "not mentioned". Use `None.` for an empty
section.

### Summary

One or two sentences describing the release as a whole. State what it is; no sales
language.

### Highlights

The notable changes, one bullet each, written as what a user can now do. Leave out
housekeeping such as dependency bumps unless the dependency changes behaviour.

### Breaking changes

Every change that breaks an existing setup: a renamed or removed tool, a changed option
default or meaning, a changed permission resource. For each, say what broke and give the
exact step to migrate. Write `None.` when there are none. Do not omit the section.

### Tools and skills

The tool surface and the skills as they stand in this release, with additions, removals,
and renames marked against the previous release.

### Options

Plugin options added or changed, with their defaults and the effect of each.

### Permissions

Any new or changed permission assertion, naming the action and the shape of the resource.
A user may need to add a config rule to allow it, so this belongs in the notes.

### Fixes

Bug fixes, one bullet each, described by the symptom that is gone rather than by the code
change.

### Upgrade notes

The steps to move from the previous release: config edits, a reload, or a service restart.
Write `None.` when an upgrade needs nothing.

### Known limitations

What this release does not handle or does not handle well. Be specific; a vague caveat is
worse than none.

## Formatting

- Markdown with sentence-case headings and no emoji.
- Reference files, tools, functions, and skills by name. Do not cite line numbers.
- Do not put totals such as test counts in the body.
- Straight quotes.
- No em dashes. Use a period, a comma, a colon, or parentheses.

## Template

```markdown
### Summary

<one or two sentences>

### Highlights

- <what a user can now do>

### Breaking changes

None.

### Tools and skills

- `tmux_example`: <what it does> (new)

### Options

- `<name>`: <effect> (default `<value>`)

### Permissions

- `<tool>` asserts the `shell` action with `<resource shape>`.

### Fixes

- <the symptom that is gone>

### Upgrade notes

None.

### Known limitations

- <what is not handled>
```
