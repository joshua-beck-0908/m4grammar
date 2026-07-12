# GNU M4 Syntax Highlighting

Syntax highlighting for the [GNU m4](https://www.gnu.org/software/m4/) macro
processor: `.m4`, `.m4i`, `.m4f`, and `aclocal.m4` files, plus M4 code cells
in Jupyter notebooks and fenced ` ```m4 ` blocks in Markdown.

This is a pure grammar/declarative extension — a `language-configuration.json`
plus a TextMate grammar (`syntaxes/m4.tmLanguage.json`). There is no language
server and no bundled compiled code; nothing to build, nothing running in the
background.

## What gets highlighted

- `#` comments (to end of line)
- `dnl` statements (highlighted like a comment, since the rest of the line is
  discarded)
- Default-quoted strings, `` `like this' ``, including nested quoting
- GNU m4's builtin macros (`define`, `ifelse`, `pushdef`, `eval`, `translit`,
  `esyscmd`, `__file__`, ...)
- `changequote` / `changecom` / `changeword` calls, highlighted distinctly
- `$1`.. `$9`, `${10}`, `$0`, `$#`, `$*`, `$@` parameter references
- Numeric literals (decimal, `0x…`, `0b…`, `0…` octal) as used by `eval()`
- A heuristic highlight for `name(` as a probable macro call, for
  user-defined macros the grammar has no other way to recognize

## Using it

**Development / trying it out:** open this folder in VS Code and press `F5`
(uses `.vscode/launch.json`) to launch an Extension Development Host with the
extension loaded. Open `examples/sample.m4` there to see it in action.

**Packaging:** `npx @vscode/vsce package` produces a `.vsix` you can install
via `code --install-extension` or the Extensions view's "Install from
VSIX...".

**Jupyter notebooks:** VS Code applies a language's TextMate grammar to a
notebook cell based on the cell's language ID, the same as it does for a
file — there's no separate notebook-specific wiring needed. Once this
extension is installed, "M4" appears as a choice in the "Change Cell
Language" command, and any cell you set to that language will be highlighted
with this grammar. (There is no standard M4 Jupyter kernel, so this is
useful for *highlighting* M4 snippets you keep in a notebook, not for
executing them from the notebook itself.)

**Markdown fenced code blocks:** VS Code's built-in Markdown grammar embeds
any installed language grammar automatically by matching the fence's info
string to a registered language ID, so ` ```m4 ` blocks get the same
highlighting, with nothing extra to configure.

## Nuances and things that are genuinely impossible to do statically

GNU m4 is not really a language with a fixed syntax — it's closer to a small,
Turing-complete macro-rewriting *system* whose lexical rules are themselves
mutable at runtime. A TextMate grammar is a stack of regexes with no memory
of what macros have been defined or what arguments were previously passed to
a macro call, so several things cannot be made fully correct in principle,
only approximated. In rough order of how much they matter in practice:

1. **`changequote` / `changecom` / `changeword` mid-file.** These builtins
   let a file redefine its own quote characters, comment delimiters, or even
   the definition of "a word" at any point, to *any* string (see
   `examples/sample.m4` for a `changequote([,])` example lifted from the
   actual GNU m4 manual). Doing this correctly would require capturing the
   literal arguments passed to a macro call at one point in the file and
   using that captured text as the delimiter pattern for a completely
   different part of the file, potentially thousands of lines later, and
   possibly changing again several more times, or being conditional on
   `ifelse`/`ifdef`. TextMate/Oniguruma grammars cannot carry that kind of
   dynamic, cross-match state — they only support backreferences *within* a
   single match, and a fixed set of statically-declared rules otherwise.
   Only a real parser (i.e., an actual m4 implementation, or a language
   server with semantic-token support) can track this. **This grammar always
   assumes the default `` ` ``/`'` quote pair and `#`/newline comment
   delimiters**, which is the common case, but highlighting after a
   `changequote`/`changecom` call to non-default delimiters will be wrong
   for the rest of the file (or until it's changed back).
2. **You cannot tell a macro call from plain text by looking at it.**
   Unlike most languages, m4 has no sigil or keyword that marks "this word
   is a macro invocation" — `foo` is a macro call if and only if `foo` has
   been `define`d (or is a builtin) *somewhere reachable*, possibly in
   another file pulled in via `include`. A bare word with no trailing `(`
   is completely ambiguous between "literal output text" and "a zero-argument
   macro call" from a purely lexical standpoint. This grammar highlights
   `name(` as a probable macro call (m4 does require the `(` to immediately
   follow the name, no space, for it to start an argument list, so that much
   is a real syntax rule), and leaves paren-less bare words unstyled rather
   than guessing.
3. **Builtin names are not reserved words.** `define`, `ifelse`, etc. are
   ordinary macros — a file is free to `undefine`, redefine, or
   `pushdef`/`popdef` over any of them (this is a common idiom, e.g. to
   temporarily rename `define` to something shorter). The grammar has no way
   to know whether a given occurrence of `define` still means the builtin at
   that point in the file, so the builtin highlighting is a hint about spelling,
   not a semantic guarantee.
4. **Arbitrary-radix `eval()` literals.** `eval()` accepts `BASE:DIGITS`
   literals for any base 2–36 (a GNU extension), in addition to `0x`/`0b`/
   leading-zero-octal/decimal. That form isn't specially highlighted.
5. **Full correctness would mean running the program.** Because macro
   expansion output is itself rescanned as new input, and expansion can be
   arbitrarily conditional (`ifelse`, `ifdef`, recursion), knowing exactly
   which bytes of a source file are "comment", "string", or "code" at a given
   point in general requires evaluating the macros — which is precisely what
   a syntax highlighter, by design, does not do. Everything above is a
   best-effort static approximation that is correct for the large majority of
   real-world `.m4` files (which mostly use default quoting/comments and only
   change them, if at all, once near the top), and degrades gracefully
   (falls back to plain text) rather than crashing or hanging on the rest.

None of this needs a language server to fix "the rest of the way" — it's not
a missing feature, it's the difference between lexing and actually running
m4. If you need guaranteed-correct output for a specific file, the only way
is to run `m4` itself (e.g. with `-E`/tracing options) and look at the real
expansion.
