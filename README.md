# GNU M4 Syntax Highlighting + Language Server

Syntax highlighting and a lightweight language server for the
[GNU m4](https://www.gnu.org/software/m4/) macro processor: `.m4`, `.m4i`,
`.m4f`, and `aclocal.m4` files; `.md.m4` files (Markdown with m4 macros -
see [below](#markdown--m4-mdm4)); M4 code cells in Jupyter notebooks; and
fenced ` ```m4 ` blocks in plain Markdown.

There are two layers:

1. A TextMate grammar (`syntaxes/m4.tmLanguage.json`) + `language-configuration.json`,
   exactly as before — instant, purely-static highlighting the moment a file
   opens, and the only thing that runs in restricted contexts (see
   [Limitations](#limitations) below).
2. A language server (`server/`) that actually **tracks m4's live lexical
   state** — the current quote/comment/word characters, and a real macro
   symbol table — as it scans the document, and layers corrected/enriched
   **semantic tokens**, hover, go-to-definition, and document symbols on top
   of the grammar. VS Code merges the two automatically: the grammar paints
   first, the language server's semantic tokens repaint anything it has
   better information about.

The language server does **not** run or expand macros. It's a structural
scanner, not an interpreter — see [What the language server still can't
do](#what-the-language-server-still-cant-do) for exactly where that line is
and why.

## What gets highlighted

- `#` comments (to end of line)
- `dnl` statements (highlighted like a comment, since the rest of the line is
  discarded)
- Quoted strings, including nested quoting, using **whatever the current
  quote characters actually are** at that point in the file (see below)
- GNU m4's builtin macros (`define`, `ifelse`, `pushdef`, `eval`, `translit`,
  `esyscmd`, `__file__`, ...) — dimmed/reclassified if a file shadows one
  (`undefine('define')`, `pushdef('define', ...)`, etc.)
- User-defined macros, including **bare references with no parentheses**
  (the language server knows these are macros because it saw the `define`)
- `changequote` / `changecom` / `changeword` calls, highlighted distinctly
- `$1`.. `$9`, `${10}`, `$0`, `$#`, `$*`, `$@` parameter references
- Numeric literals (decimal, `0x…`, `0b…`, `0…` octal) as used by `eval()`
- Calls to names that resolve to nothing reachable, in their own subtle
  style (`entity.name.function.unresolved.m4`) — distinct from both
  "known builtin" and "known user macro"

## The headline improvement over grammar-only highlighting

The GNU m4 manual's own example for adopting bracket-style quoting is:

```m4
changequote([,])dnl
define([foo], [bar])dnl
foo
```

A TextMate grammar can never highlight this correctly: it has no memory, so
it can't know that `[` and `]` became the quote characters, and it can't know
that bare `foo` on the third line is a macro call rather than plain output
text. The language server tracks both: it sees `changequote([,])` and
switches its own idea of "quote characters" from that point on, sees
`define([foo], ...)` using the *new* quote characters, and then correctly
recognizes the bare `foo` reference afterward as a call to a known macro —
hover it to see its body, or jump to its definition.

This also works across `include()`/`sinclude()` — the language server reads
included files (relative to the including file's directory, and to the
workspace root, up to a configurable depth, with cycle detection) purely to
harvest their macro definitions and any lexical state changes they make, so
macros defined in a helper file are recognized, with hover/go-to-definition
pointing into that file, when used from the file you're editing.

## Markdown + m4 (`.md.m4`)

Files named `*.md.m4` get a dedicated "Markdown+M4" language mode: full
CommonMark highlighting (headings, emphasis, links, tables, fenced code,
...) via VS Code's own built-in Markdown grammar, with m4 syntax layered on
top wherever it appears - including in the middle of a multi-line paragraph
or list item, not just at the start of a line.

This composition works cleanly *because* m4 has no "escape into code"
delimiter the way PHP-in-HTML or `<script>`-in-HTML do: the entire file is
always m4 source, and any text m4 doesn't specifically recognize just passes
through untouched. So there was no embedded-language boundary to design -
`syntaxes/m4-markdown.tmLanguage.json` is the stock Markdown grammar under a
new scope name, and `syntaxes/m4-markdown-injection.tmLanguage.json` is an
**injection** grammar (`injectTo`/`injectionSelector`, high priority) that
tries the same m4 rules the plain `.m4` grammar uses at every position,
before falling through to whatever Markdown would otherwise do there. A
plain "base grammar + include" composition can't do this - once Markdown's
own paragraph/list rule starts matching, only *its own* nested patterns get
tried for the rest of that block; injections are specifically designed to
keep competing at every position regardless of nesting.

### The one thing you actually need to know: change the quote/comment characters

m4's **default** quote character is a backtick, and Markdown's inline code
spans and fenced code blocks are *also* delimited by backticks - but m4
quoting is backtick-to-**apostrophe** (an asymmetric pair), while Markdown's
code spans are backtick-to-**backtick** (symmetric). Write ```` `like this` ````
in prose under m4's default quoting and m4 sees an *opened, unterminated*
quote at the first backtick (with the second backtick read as the start of
a *nested* quote, since backtick never closes anything to m4) - and it keeps
consuming everything after it, across the rest of the paragraph, through
fenced code blocks, potentially to the end of the file, looking for an
apostrophe that was never meant to close anything. This isn't just a
highlighting quirk: it's exactly what real `m4` would also do to the file's
actual output. Similarly, m4's default comment character `#` is Markdown's
heading marker, and comments don't take arguments the way headings visually
suggest they might - `# My Heading` is simply, entirely, a comment to m4 by
default.

The fix is the one the GNU m4 manual itself recommends for this exact
situation: pick different characters. `examples/sample.md.m4` (and the
`m4md-preamble` snippet, triggered by typing `m4md-preamble` in a `.md.m4`
file) starts every file with:

```m4
changequote([[,]])dnl
changecom([[<!--]],[[-->]])dnl
```

`[[`/`]]` doesn't collide with anything in CommonMark (single `[...]` is link
syntax, but doubled brackets aren't used for anything). `<!--`/`-->` is a
deliberate choice, not just an arbitrary safe one: it's Markdown's *own*
HTML-comment syntax, so anything you wrap in it is simultaneously an m4
comment (protected from macro expansion, but still copied to the output)
*and* hidden from the rendered Markdown - one wrapper does both jobs. The
one trade-off: with the default `#` comment character, headings were
*accidentally* protected from macro expansion (a heading is a comment to
m4); switching to `<!--`/`-->` means headings now participate in expansion
like everything else, which is usually what you actually want in a
templated document, but is worth knowing about.

**The `.md.m4` static grammar assumes this convention, not m4's defaults.**
A static grammar has to hardcode *some* set of delimiters, and for `.md.m4`
the recommended convention is the right bet: the injection grammar treats
`[[...]]` as the m4 quote pair and `<!--`/`-->` as the m4 comment pair, and
leaves backtick and `#` entirely to Markdown (inline code and headings).
So a file that follows the preamble looks right from the static layer alone
- no language server required for basic correctness, and it works even in
themes with semantic highlighting disabled. A `.md.m4` file that *doesn't*
follow the convention (i.e. actually uses default backtick/`#` m4 syntax)
won't have its m4 strings/comments statically highlighted; the language
server corrects that case, since it tracks the real live delimiters
regardless of what either grammar assumes - its comment/string semantic
tokens are ordinary token types every semantic-capable theme resolves.
(This is the reverse of plain `.m4` files, whose grammar assumes the m4
defaults - same mechanism, opposite bet, each matching what's common for
that file type.)

Also note that m4 has no idea what Markdown is: a bare macro reference
inside a fenced code block or inline code span still expands, since m4
processes the raw bytes of the file before it's Markdown at all. The example
file uses this on purpose (an install command's URL tracks a `PROJECT`
macro's value even though it's written inside a fence) - but it means you
can't rely on code spans/fences to "protect" example text containing what
looks like a macro name; quote it with m4's own quotes if you want it to
survive literally.

## Unicode identifiers (wrapper dialect)

Standard GNU m4 restricts macro names to ASCII `[_A-Za-z][_A-Za-z0-9]*`;
non-ASCII bytes are single-character tokens copied straight through. Some
wrapper scripts extend m4 so that **every byte with the high bit set
(0x80-0xFF) is a valid identifier byte** - which, in UTF-8, is exactly the
same as saying every non-ASCII *character* is an identifier character,
since all bytes of a multi-byte UTF-8 sequence have the high bit set. In
that dialect this works (see `examples/unicode.md.m4`):

```m4
define(≡📅,2026-07-19)
*Written on ≡📅*
```

expanding to `*Written on 2026-07-19*`.

This extension supports that dialect, in both layers:

- The **static grammars** treat non-ASCII characters as identifier
  characters unconditionally (a TextMate grammar can't be toggled by a
  setting). So `≡📅(x)` highlights as a macro call, and word boundaries are
  dialect-style: `édnl` reads as one plain identifier, not an `é` followed
  by a `dnl` invocation. For standard-m4 files this is almost always
  invisible - bare words get no static styling either way, and ASCII text
  tokenizes identically under both rules - but it is technically a
  dialect bet, in the same spirit as the `.md.m4` grammar's delimiter bet.
- The **language server** honors the `m4.unicodeIdentifiers` setting
  (default `true`). When on, `define(≡📅, ...)` is tracked like any other
  definition: the bare `≡📅` reference later highlights, hovers to its
  body, and supports go-to-definition. When off, the analyzer applies
  strict GNU m4 tokenization: Unicode names aren't tracked (real m4 would
  reject them), and boundary semantics revert to standard (in `édnl`,
  standard m4 really does invoke `dnl`, and the analyzer will treat it
  that way - correcting the static grammar's dialect assumption with its
  own semantic tokens where they differ).

All internal offsets are UTF-16 code units (matching the LSP's default
position encoding), so identifiers containing astral-plane characters like
emoji keep correct highlight spans and hover ranges.

## Using it

**Development / trying it out:** `npm install`, then open this folder in VS
Code and press `F5` (uses `.vscode/launch.json`) to launch an Extension
Development Host with the extension loaded. Open `examples/sample.m4` there
to see it in action.

**Building:** `npm run build` bundles the client and server (via esbuild)
into `out/`. `npm run typecheck` type-checks both without emitting.

**Packaging:** `npm run package` (a thin wrapper around
`vsce package --no-dependencies`) runs the build automatically
(`vscode:prepublish`) and produces a self-contained `.vsix` (no
`node_modules` needed at install time) you can install via
`code --install-extension` or the Extensions view's "Install from VSIX...".
The `--no-dependencies` flag is required, not cosmetic: without it, `vsce`'s
default dependency-detection step prunes `devDependencies` (which is where
`vscode-languageserver`/`vscode-languageclient`/etc. live) from
`node_modules` *before* the esbuild bundling step runs, so the build fails
looking for packages that were just deleted. Everything actually needed at
runtime is already bundled into `out/` by esbuild, so there's nothing for
`vsce` to detect here.

`@vscode/vsce` is pinned to the `2.x` line (which only requires Node >= 16)
rather than the current `3.x` (which requires Node >= 20, and its `undici`
dependency will crash with `ReferenceError: File is not defined` on anything
older, since `File` only became a Node global in v20). This is purely about
what your local machine needs to *run the packaging tool* - it has no
bearing on the extension itself, which VS Code always runs with its own
bundled Node regardless of what's on your `PATH` (and esbuild already
targets `node18` for the output in `out/`, well below either requirement).
If you're already on Node 20+ and would rather track the latest `vsce`,
`npm install --save-dev @vscode/vsce@latest` is safe - nothing else in this
repo depends on which major version of `vsce` you use.

**Settings:**
- `m4.maxIncludeDepth` (default 8) — how many levels of `include()`/`sinclude()`
  the language server will follow.
- `m4.unicodeIdentifiers` (default `true`) — treat every non-ASCII character
  as an identifier character in the language server's tokenization (the
  wrapper dialect described [above](#unicode-identifiers-wrapper-dialect));
  set to `false` for strict GNU m4 semantics.
- `m4.trace.server` — standard LSP client/server message tracing, for
  debugging the extension itself.

**`.md.m4` snippet:** type `m4md-preamble` in a `.md.m4` file and accept the
suggestion to insert the recommended `changequote`/`changecom` preamble
described [above](#markdown--m4-mdm4).

**Jupyter notebooks:** VS Code applies a language's grammar and language
server to a notebook cell based on the cell's language ID, same as a file.
Once this extension is installed, "M4" appears in the "Change Cell Language"
command; any cell set to it gets full highlighting, hover, and
go-to-definition. (There's no standard M4 Jupyter kernel, so this is for
*highlighting/reading* M4 snippets kept in a notebook, not executing them.)

**Markdown fenced code blocks:** VS Code's built-in Markdown grammar embeds
any installed language's grammar automatically by matching the fence's info
string to a registered language ID, so ` ```m4 ` blocks get the base grammar
highlighting (the language server doesn't attach to embedded Markdown code
blocks, only to real M4 documents/cells).

## How the language server works

`server/src/lexer.ts` is a single hand-written scanner (`M4Analyzer`) that
walks the document once, left to right, mirroring the structure of GNU m4's
own `input.c`/`macro.c`: it threads live quote characters, comment
delimiters, a word regexp, and a real macro symbol table (a stack per name,
so `pushdef`/`popdef` nest correctly) through the scan, exactly like m4 does
internally — just without ever expanding a macro or evaluating a condition.

A call to one of `define` / `pushdef` / `undefine` / `popdef` / `changequote`
/ `changecom` / `changeword` / `include` / `sinclude` is honored **the
moment it's lexically seen**, but only when the arguments it needs are
**literal** — meaning their exact text is knowable without expanding
anything else. Literal text includes: quoted strings, ordinary unquoted
punctuation (this is what makes `changequote([,])` work — `[` and `]` are
never quoted there, they're just plain characters that happen not to be
bound to any macro), digits, and bare words that aren't currently macros.
It stops being literal the moment it includes a call to something we can't
resolve, a currently-bound macro name (its expansion is unknowable to us),
or a comment/`dnl` (rare inside a call's arguments, and not worth the
complexity of tracking precisely).

One deliberate safety property: decorative highlighting *inside* a quoted
string (e.g. recognizing `eval` or `$1` written inside a macro body, for
readability) never starts parsing an argument list looking for a matching
`)`. Shell code is extremely common inside `.m4`/`.ac` files, and shell is
full of unbalanced-looking parens relative to m4 (`case ... in yes) ... ;;
esac`, `foo() { ... }`); without this guardrail, a stray `(` inside a quoted
macro body could send the scanner hunting for a `)` that lives outside the
string entirely, potentially misreading the rest of the file. Real macro
calls at the actual top level are still fully parsed (recursively, with
correct comma/paren-depth tracking); if *those* are unbalanced, the analyzer
reports a diagnostic and stops cleanly rather than hanging.

Semantic tokens can only *add* corrected classifications - they can't erase
a stale grammar guess for a span that otherwise gets no token at all. That
matters for two of the plain-`.m4` grammar's hardcoded assumptions
specifically: a bare `#` is only recognized by the analyzer when it's a
live comment start, so after `changecom` moves comments elsewhere, a plain
`#` character produces no token by default, leaving the grammar's
unconditional `#.*$` comment rule to keep winning uncontested; the same
happens to a builtin (or `dnl`) name once it's been `undefine()`'d. Both
are explicitly claimed with a `plainOverride` semantic token emitted for
exactly those spans. Two subtleties about how that renders:

- A semantic token whose type resolves to *no* theme rule at all is simply
  ignored by VS Code - the TextMate color stays. So mapping `plainOverride`
  to an unstyled scope would be a no-op; it's instead mapped (see
  `package.json`'s `semanticTokenScopes`) to `meta.embedded.block.m4`,
  because `meta.embedded` is a scope the standard VS Code theme families
  explicitly pin to the editor's default foreground (it's the same
  mechanism Markdown itself uses to keep code blocks un-italicized).
  Themes that neither support semantic tokens nor style `meta.embedded`
  will still show the stale comment color in plain `.m4` after a
  `changecom` - if that bites you, check `editor.semanticHighlighting.enabled`
  (some themes turn it off) or use the `.md.m4` mode, whose grammar doesn't
  have this problem by construction.
- In `.md.m4` the stale-`#` override is deliberately *not* emitted: that
  grammar already gives `#` to Markdown's heading rule (the correct
  rendering), so there's nothing stale to neutralize - and macro references
  inside a heading still get their own tokens, since they really do expand
  there.

This is scoped narrowly on purpose: it does *not* attempt the equivalent
for a stray backtick after `changequote` moves quoting elsewhere in a plain
`.m4` file, since that grammar's quoted-string rule can match an unbounded,
multi-line span (as opposed to `#`/`dnl`, which it only ever lets run to
the end of the current line). Keeping default-quoted highlighting for plain
`.m4` and convention-quoted highlighting for `.md.m4` - and letting the
language server's positive tokens bridge the gap in both directions - is
the deliberate trade.

## What the language server still can't do

This is now a much shorter list than "impossible with a grammar alone,"
but a few things are still out of reach without literally running m4 (which
this deliberately does not do — see below):

1. **Conditionally-executed state changes.** `changequote`/`define`/etc. are
   applied as soon as they're *seen*, regardless of whether they sit inside
   an `ifelse`/`ifdef` branch that would never actually run. Evaluating that
   condition would mean evaluating `eval()` expressions, which can depend on
   things outside the file (environment, `esyscmd()` shelling out) — the
   scanner deliberately never does that. In practice this only matters for
   files that conditionally redefine their own syntax, which is rare.
2. **Computed or concatenated arguments.** `define(translit(NAME, ...), BODY)`
   or `define(PREFIX``SUFFIX, BODY)` have a name that only exists after
   expansion; the analyzer can't know it, so that definition is silently not
   tracked (not tracked incorrectly — just not tracked at all).
3. **`m4 -D`/`-U` command-line definitions**, and macros defined by files
   outside the workspace / not reachable via `include()` resolution (m4's
   real `-I` search path isn't something a file on disk exposes to an
   editor). Those macros will show as "unresolved."
4. **Arbitrary-radix `eval()` literals** (`BASE:DIGITS`, a GNU extension)
   aren't specially highlighted, just plain decimal/hex/binary/octal.
5. **Requires a Node.js-capable extension host.** The language server is a
   normal (non-web) extension; it runs fine in desktop VS Code,
   Remote-SSH/WSL/devcontainers, and Codespaces, but it will **not** activate
   in the browser-only vscode.dev/github.dev web extension host. The
   TextMate grammar still works everywhere, including there, as a fallback.
6. **No incremental reparsing.** The whole document (plus its includes) is
   rescanned on every edit. This is fast enough for ordinary macro files; a
   very large generated `.m4` could feel it. There's a hard step-count safety
   valve that stops cleanly (falling back to the grammar's static
   highlighting for the remainder) rather than ever hanging the editor.

None of this is a missing feature so much as the line between *lexing* and
*actually running* m4 — which is inherently undecidable in general, since m4
is Turing-complete (some real macros, like the classic recursive `forloop`,
don't even terminate). If you need guaranteed-correct output for a specific
file, the only way is to run `m4` itself and look at the real expansion.
