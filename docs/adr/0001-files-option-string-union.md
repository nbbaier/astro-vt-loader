# ADR 0001: Use a string union for the files option

## Status

Accepted

## Context

The loader needs to support three levels of file data fetching: no files, file list only, and file list plus content. The obvious approach is two booleans (`includeFiles`, `includeFileContent`), but this creates an impossible state (`includeFiles: false, includeFileContent: true`) that must be handled defensively.

## Decision

Use a single `files` option with type `"none" | "list" | "content"`, defaulting to `"none"`.

- `"none"`: fetch only val metadata. The `files` array on entries is empty.
- `"list"`: fetch file metadata (names, paths, types, URLs) but not content.
- `"content"`: fetch file metadata and raw source text. Implies `"list"`.

## Consequences

- Eliminates impossible states at the type level.
- Single option is simpler to document and reason about.
- Adding a fourth tier later (e.g., parsed AST) extends the union without breaking existing configs.
- Slightly less discoverable than booleans for users who expect `includeX` patterns, but reads clearly in context: `valTownLoader({ files: "content" })`.
