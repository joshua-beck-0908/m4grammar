# Changelog

## 0.2.0

- Added a language server (`server/`) that tracks m4's live lexical state
  (quote/comment/word characters via `changequote`/`changecom`/`changeword`)
  and a real macro symbol table (`define`/`pushdef`/`undefine`/`popdef`,
  including `include()`/`sinclude()` resolution), and layers corrected
  semantic tokens on top of the base TextMate grammar.
- Adds hover (shows a builtin's summary, or a user macro's body and defining
  file), go-to-definition, and document symbols.
- Bare macro references (no trailing parens) are now highlighted when the
  server has seen their `define`, and highlighting correctly follows
  `changequote`/`changecom` changes for the rest of the file.
- The extension is now a compiled/bundled extension (esbuild -> `out/`)
  rather than pure declarative JSON; `npm install && npm run build` before
  running.

## 0.1.0

- Initial release: TextMate grammar and language configuration for GNU m4
  (`.m4`, `.m4i`, `.m4f`, `aclocal.m4`).
- Highlights: `#` comments, `dnl` statements, default `` ` '' ``-quoted
  strings (with nesting), GNU m4 builtin macros, `changequote`/`changecom`/
  `changeword`, `$1`.. `$9`/`$0`/`$#`/`$*`/`$@` parameter references, and
  numeric literals.
- Works in Jupyter notebook code cells whose language is set to M4, and in
  fenced ```` ```m4 ```` blocks in Markdown, with no extra configuration.
