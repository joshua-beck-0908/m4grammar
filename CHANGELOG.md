# Changelog

## 0.4.0

- Added Unicode-identifier support (the wrapper-script dialect where every
  UTF-8 byte with the high bit set - equivalently, every non-ASCII
  character - is a valid identifier character), so `define(≡📅,2026-07-19)`
  defines a macro named `≡📅` and a later bare `≡📅` is recognized as a
  reference, with highlighting, hover, and go-to-definition.
- The static grammars treat non-ASCII as identifier characters
  unconditionally (grammars can't be setting-toggled; ASCII files tokenize
  identically either way). The language server honors a new
  `m4.unicodeIdentifiers` setting (default `true`); set it to `false` for
  strict GNU m4 tokenization, where non-ASCII bytes are pass-through
  tokens and word boundaries fall accordingly.
- Editor word operations (double-click selection etc.) include non-ASCII
  identifier characters via updated `wordPattern`s.
- Added `examples/unicode.md.m4`.

## 0.3.2

- Fixed (for real this time): `#` headings in `.md.m4` files no longer
  render as m4 comments. The `.md.m4` injection grammar now hardcodes the
  recommended convention instead of m4's defaults - `[[...]]` as the quote
  pair, `<!--`/`-->` as the comment pair - and leaves `#` and backtick
  entirely to Markdown (headings, inline code, fences). Files following the
  `m4md-preamble` convention now render correctly from the static grammar
  alone, with no language server and no semantic-token support required.
- The 0.3.1 `plainOverride` fix was ineffective as shipped: VS Code ignores
  a semantic token that resolves to no theme rule (the stale TextMate color
  stays), and the root-scope mapping resolved to nothing. It's now mapped to
  `meta.embedded.block.m4`, which the standard theme families pin to the
  editor's default foreground. It also no longer fires in `.md.m4`, where a
  stale `#` is correctly a Markdown heading that shouldn't be flattened.
- Fixed a cascade bug found while testing the new grammar: the injection
  applied inside its own comment/string regions (an injection selector
  matches anywhere the root scope is on the stack), so the `<!--` rule could
  fire inside `[[<!--]]` and swallow the rest of the file; the selector now
  excludes `comment` and `string` scopes.
- The `m4md-preamble` snippet and example now use the quoted
  `changecom([[<!--]],[[-->]])` form.

## 0.3.1

- Fixed: after `changecom` moves comments away from `#`, a literal `#` (e.g.
  a Markdown-style heading, or just a `#` in prose) stayed colored as a
  comment. Semantic tokens can only *add* corrected classifications for
  spans the language server positively recognizes; a `#` under a changed
  comment character is simply an ordinary, unrecognized character to the
  scanner, so it emitted no token at all, and the static grammar's hardcoded
  `#.*$` rule kept winning uncontested. Same underlying issue for a builtin
  name (or `dnl`) after it's been `undefine()`'d - the grammar still colors
  it as a keyword regardless of live binding. Both are now explicitly
  neutralized with a new `plainOverride` semantic token type, mapped to each
  language's own root scope so it renders as ordinary text.
- Pinned `@vscode/vsce` to the `2.x` line (was `3.x`, which requires Node 20
  and crashes on Node 18 with `ReferenceError: File is not defined`) and
  fixed `npm run package` to pass `--no-dependencies` (without it, `vsce`
  prunes the `devDependencies` esbuild needs to bundle *before* running the
  build).

## 0.3.0

- Added a "Markdown+M4" language mode for `.md.m4` files: the stock Markdown
  grammar with m4 syntax (comments, `dnl`, quoted strings, macro calls,
  `changequote`/`changecom`) layered on top via a TextMate injection grammar,
  so m4 constructs are recognized anywhere in the document, including in the
  middle of an already-open paragraph or list item, not just at line starts.
  The language server attaches here too, so live `changequote`/`changecom`
  tracking and bare macro-reference recognition work the same as in `.m4`
  files.
- Documents (and works around, via a recommended `changequote`/`changecom`
  preamble and a matching `m4md-preamble` snippet) a real collision between
  m4's default quote/comment characters and Markdown's own syntax: m4's
  default quote is an asymmetric backtick/apostrophe pair, while Markdown's
  inline code and fenced code blocks use symmetric backtick pairs, which
  otherwise cascades into corrupted highlighting for the rest of the file.
- Adds `examples/sample.md.m4` demonstrating the safe convention.

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
