// A non-expanding, structural m4 scanner.
//
// Unlike a TextMate grammar, this walks the *whole* document (and, best-effort,
// files it include()s) as a single pass, threading live state through it the
// same way GNU m4's own input.c does: the current quote/comment/word
// characters, and a real macro symbol table (define/undefine/pushdef/popdef),
// are mutated as we go, so `foo` after `changequote([,])` is read correctly
// even though the grammar's regexes could never know that happened.
//
// It deliberately does NOT expand macros or evaluate control flow (ifelse,
// eval, esyscmd...). Doing that fully would mean actually running m4 - see
// README.md for why that's not just a missing feature. Concretely, this means:
//   - A changequote()/changecom()/define() call is honored as soon as it is
//     lexically *seen* with literal (already-quoted) arguments, regardless of
//     whether it sits inside an `ifelse` branch that would never actually run.
//   - Only calls whose relevant arguments are simple, literal quoted strings
//     are tracked; anything computed (nested macro calls, concatenation) is
//     left alone, since we have no way to know its value without expanding it.
//
// This is a pragmatic middle ground: it is correct for the very common case
// of unconditional, top-of-file changequote/definitions, and degrades to
// "unknown" (never to a crash or a hang) for anything more dynamic.

import * as path from 'path';

export enum SemTokenType {
  Comment,
  Keyword,
  String,
  FunctionBuiltin,
  FunctionUser,
  FunctionUnknown,
  MacroDecl,
  MacroUndecl,
  Parameter,
  Number,
  /** A span the *static* grammar would still color under its hardcoded default
   *  assumptions (a bare `#` when the live comment character is no longer `#`;
   *  a builtin/`dnl` name that's been undefined), even though live tracking
   *  says it isn't special any more. Semantic tokens only ever *add* corrected
   *  classifications - they can't erase a stale grammar guess for a span that
   *  otherwise gets no token at all - so this exists purely to explicitly
   *  claim those specific spans and neutralize them. Mapped in package.json to
   *  meta.embedded.block.m4: a semantic token whose fallback scope resolves to
   *  NO theme rule is ignored entirely (the stale TextMate color stays
   *  visible), and meta.embedded is a scope the standard VS Code theme
   *  families explicitly pin to the editor's default foreground. */
  PlainOverride,
}

export interface SemToken {
  start: number;
  end: number;
  type: SemTokenType;
}

export type DiagSeverity = 'error' | 'warning' | 'info';

export interface AnalyzerDiagnostic {
  start: number;
  end: number;
  message: string;
  severity: DiagSeverity;
}

export interface MacroDefFrame {
  kind: 'builtin' | 'user';
  /** For user macros: the literal body text, if it was itself a literal quoted string. */
  body?: string;
  /** For builtins: a short human-readable description, for hover. */
  summary?: string;
  declUri?: string;
  declNameStart?: number;
  declNameEnd?: number;
}

export interface Usage {
  start: number;
  end: number;
  name: string;
  uri: string;
  resolved?: MacroDefFrame;
}

export interface Declaration {
  name: string;
  nameStart: number;
  nameEnd: number;
  uri: string;
  kind: 'define' | 'pushdef';
  bodyPreview?: string;
}

export interface AnalyzeResult {
  tokens: SemToken[];
  diagnostics: AnalyzerDiagnostic[];
  usages: Usage[];
  declarations: Declaration[];
}

export interface ResolvedInclude {
  absPath: string;
  text: string;
}

export interface AnalyzeOptions {
  maxIncludeDepth: number;
  /** Resolve + read an include()/sinclude() target. Returns undefined if not found/unreadable. */
  resolveAndRead: (spec: string, baseDir: string) => ResolvedInclude | undefined;
  /** Seed data for builtins: name -> hover summary, and which names have a tracked side effect. */
  builtinSummaries: ReadonlyMap<string, string>;
  effectfulBuiltins: ReadonlySet<string>;
  /** Whether a stale `#` (not a live comment start any more) should be claimed
   *  with PlainOverride tokens. True for plain .m4, where the static grammar
   *  wrongly keeps comment-coloring it. False for .md.m4 (m4-markdown), whose
   *  grammar gives `#` to Markdown's heading rule - the correct rendering,
   *  which an override would flatten back to plain text. When false, the `#`
   *  is simply skipped and the rest of the line scans normally, so macro
   *  references inside a heading still highlight (they really do expand
   *  there). Defaults to true when omitted. */
  emitStaleHashOverride?: boolean;
  /** Unicode-identifier wrapper dialect (the m4.unicodeIdentifiers setting):
   *  every non-ASCII character counts as an identifier character, so
   *  `define(≡📅, ...)` defines a macro named ≡📅 and a bare `≡📅` later is a
   *  reference to it. In UTF-8 terms this is exactly "every byte with the
   *  high bit set is an identifier byte", since all bytes of a multi-byte
   *  UTF-8 sequence have the high bit set. Standard GNU m4 restricts words
   *  to ASCII [_A-Za-z][_A-Za-z0-9]*; non-ASCII bytes are single-character
   *  tokens copied through, which also changes where word boundaries fall
   *  (in standard m4, `é` immediately followed by `dnl` still invokes dnl;
   *  in this dialect `édnl` is one plain identifier). Defaults to true when
   *  omitted, matching the static grammar's (unconditional) bet. */
  unicodeIdentifiers?: boolean;
}

const ASCII_WORD_SOURCE = '[A-Za-z_][A-Za-z0-9_]*';
// The \u0080-\uffff range, on a JS (UTF-16) string, covers every non-ASCII
// character: astral-plane characters like the calendar emoji are surrogate
// pairs whose halves both fall inside that range, so the whole character is
// consumed unit by unit and identifier spans stay contiguous.
// \u27e6/\u27e7 (the recommended quote delimiters, and the only characters this
// extension treats as brackets) are carved out of the identifier classes: a
// character can't sensibly be both a quote delimiter and an identifier
// character, and the delimiter reading is the useful one.
const UNICODE_WORD_SOURCE = '[A-Za-z_\\u0080-\\u27e5\\u27e8-\\uffff][A-Za-z0-9_\\u0080-\\u27e5\\u27e8-\\uffff]*';
const NUMBER_RE = /(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[0-7]*|[1-9][0-9]*)/y;
const PARAM_RE = /\$(?:\{[0-9]+\}|[0-9]+|#|\*|@)/y;
const WHITESPACE_RE = /[ \t\r\n\f\v]/;
const ASCII_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNICODE_NAME_RE = new RegExp(`^${UNICODE_WORD_SOURCE}$`);

function makeDefaultWordRegex(unicodeIdentifiers: boolean): RegExp {
  return new RegExp(unicodeIdentifiers ? UNICODE_WORD_SOURCE : ASCII_WORD_SOURCE, 'y');
}

interface SourceFrame {
  uri: string;
  text: string;
  pos: number;
  baseDir: string;
  absPath?: string;
}

interface ArgLiteral {
  text: string;
  innerStart: number;
  innerEnd: number;
}

interface ParsedArg {
  literal?: ArgLiteral;
}

interface ParsedCall {
  args: ParsedArg[];
  closed: boolean;
}

export class M4Analyzer {
  private readonly rootUri: string;
  private readonly opts: AnalyzeOptions;
  private frames: SourceFrame[];
  private activeIncludePaths = new Set<string>();

  private quoteLeft = '`';
  private quoteRight = "'";
  private commentBegin = '#';
  private commentEnd = '\n';
  private commentsDisabled = false;
  private wordRegex: RegExp;
  private readonly validNameRe: RegExp;
  private readonly unicodeIdentifiers: boolean;
  private inQuoteDepth = 0;

  private symtab = new Map<string, MacroDefFrame[]>();

  private tokens: SemToken[] = [];
  private diagnostics: AnalyzerDiagnostic[] = [];
  private usages: Usage[] = [];
  private declarations: Declaration[] = [];

  constructor(rootUri: string, rootText: string, rootBaseDir: string, opts: AnalyzeOptions) {
    this.rootUri = rootUri;
    this.opts = opts;
    this.unicodeIdentifiers = opts.unicodeIdentifiers !== false;
    this.wordRegex = makeDefaultWordRegex(this.unicodeIdentifiers);
    this.validNameRe = this.unicodeIdentifiers ? UNICODE_NAME_RE : ASCII_NAME_RE;
    this.frames = [{ uri: rootUri, text: rootText, pos: 0, baseDir: rootBaseDir }];
    for (const [name, summary] of opts.builtinSummaries) {
      this.symtab.set(name, [{ kind: 'builtin', summary }]);
    }
  }

  analyze(): AnalyzeResult {
    const MAX_STEPS = rootTextStepBudget(this.frames[0].text.length);
    let steps = 0;
    while (!this.isEOF()) {
      this.stepTopLevel();
      if (++steps > MAX_STEPS) {
        this.emitDiag(this.top().pos, this.top().pos, 'Analysis stopped early: input is too large or degenerate for the live macro tracker (falling back to plain highlighting past this point).', 'info');
        break;
      }
    }
    this.tokens.sort((a, b) => a.start - b.start);
    this.usages.sort((a, b) => a.start - b.start);
    return { tokens: this.tokens, diagnostics: this.diagnostics, usages: this.usages, declarations: this.declarations };
  }

  // ---- source-frame plumbing -------------------------------------------------

  private top(): SourceFrame {
    return this.frames[this.frames.length - 1];
  }

  private isEOF(): boolean {
    while (this.frames.length > 1 && this.top().pos >= this.top().text.length) {
      const finished = this.frames.pop()!;
      if (finished.absPath) this.activeIncludePaths.delete(finished.absPath);
    }
    return this.top().pos >= this.top().text.length;
  }

  private startsWithAt(s: string, offsetFromPos = 0): boolean {
    if (s.length === 0) return false;
    const f = this.top();
    return f.text.startsWith(s, f.pos + offsetFromPos);
  }

  /** Matches an identifier at the current position. Delimiter strings always
   *  win over identifier characters: with unicode identifiers on, a non-ASCII
   *  quote or comment delimiter (e.g. « from changequote(«,»)) is *also* a
   *  word character, and a greedy word match would otherwise swallow it - so
   *  `Prize»` would become one identifier, the enclosing string would never
   *  see its closing delimiter, and a spurious unclosed-string cascade would
   *  swallow the rest of the file. The match is truncated at the earliest
   *  occurrence of any currently-active delimiter. */
  private matchWordHere(): string | null {
    const f = this.top();
    this.wordRegex.lastIndex = f.pos;
    const m = this.wordRegex.exec(f.text);
    if (!m) return null;
    let word = m[0];
    for (const delim of [this.quoteLeft, this.quoteRight, this.commentBegin]) {
      if (!delim) continue;
      const i = word.indexOf(delim);
      if (i !== -1) word = word.slice(0, i);
    }
    return word.length > 0 ? word : null;
  }

  private matchStickyHere(re: RegExp): string | null {
    const f = this.top();
    re.lastIndex = f.pos;
    const m = re.exec(f.text);
    return m ? m[0] : null;
  }

  // ---- emission ----------------------------------------------------------

  private emitToken(start: number, end: number, type: SemTokenType): void {
    if (end <= start) return;
    if (this.top().uri === this.rootUri) this.tokens.push({ start, end, type });
  }

  /** Like emitToken, but first drops any existing token covering the exact same
   *  span. Used for MacroDecl/MacroUndecl, which can otherwise collide with a
   *  plain FunctionUser/FunctionBuiltin token already emitted for that same
   *  identifier while it was being decoratively scanned inside its own quotes
   *  (e.g. `pushdef(\`x', ...)` when `x` was already bound to something). */
  private emitTokenReplacing(start: number, end: number, type: SemTokenType): void {
    if (end <= start) return;
    if (this.top().uri !== this.rootUri) return;
    this.tokens = this.tokens.filter((t) => !(t.start === start && t.end === end));
    this.tokens.push({ start, end, type });
  }

  private emitDiag(start: number, end: number, message: string, severity: DiagSeverity): void {
    if (this.top().uri === this.rootUri) this.diagnostics.push({ start, end, message, severity });
  }

  private emitUsage(u: Usage): void {
    if (u.uri === this.rootUri) this.usages.push(u);
  }

  private emitDecl(d: Declaration): void {
    if (d.uri === this.rootUri) this.declarations.push(d);
  }

  // ---- symbol table --------------------------------------------------------

  private currentBinding(name: string): MacroDefFrame | undefined {
    const stack = this.symtab.get(name);
    return stack && stack.length ? stack[stack.length - 1] : undefined;
  }

  private pushOrReplace(name: string, frame: MacroDefFrame, isPush: boolean): void {
    let stack = this.symtab.get(name);
    if (!stack) {
      stack = [];
      this.symtab.set(name, stack);
    }
    if (isPush || stack.length === 0) stack.push(frame);
    else stack[stack.length - 1] = frame;
  }

  private popOne(name: string): void {
    const stack = this.symtab.get(name);
    if (!stack || stack.length === 0) return;
    stack.pop();
    if (stack.length === 0) this.symtab.delete(name);
  }

  // ---- top-level driver ----------------------------------------------------

  private stepTopLevel(): void {
    if (this.tryComment()) return;
    if (this.tryDnl()) return;
    if (this.quoteLeft.length > 0 && this.startsWithAt(this.quoteLeft)) {
      this.scanQuotedString();
      return;
    }
    if (this.tryWord(true)) return;
    if (this.matchStickyHere(NUMBER_RE)) {
      this.consumeMatch(NUMBER_RE, SemTokenType.Number);
      return;
    }
    if (this.matchStickyHere(PARAM_RE)) {
      this.consumeMatch(PARAM_RE, SemTokenType.Parameter);
      return;
    }
    if (this.opts.emitStaleHashOverride !== false && this.tryStaleHashOverride()) return;
    this.top().pos += 1;
  }

  /** Reaching here means `tryComment()` already determined that a literal
   *  `#` at the current position is *not* a live comment start (either
   *  `changecom` moved it elsewhere, or comments are disabled). The static
   *  grammar has no such awareness and always matches `#.*$` as a comment.
   *  Re-scans the rest of the line (properly recognizing any real m4
   *  constructs still in it, e.g. a macro call after the stale `#`) and
   *  fills the plain gaps with PlainOverride tokens so that stale coloring
   *  can't show through. */
  private tryStaleHashOverride(): boolean {
    const f = this.top();
    if (f.text.charAt(f.pos) !== '#') return false;
    const nl = f.text.indexOf('\n', f.pos);
    const lineEnd = nl === -1 ? f.text.length : nl;
    let runStart = f.pos;
    while (f.pos < lineEnd) {
      const before = f.pos;
      const tokensBefore = this.tokens.length;
      const attempted =
        this.tryComment() ||
        this.tryDnl() ||
        (this.quoteLeft.length > 0 && this.startsWithAt(this.quoteLeft) && (this.scanQuotedString(), true)) ||
        this.tryWord(true) ||
        this.consumeIfMatch(NUMBER_RE, SemTokenType.Number) ||
        this.consumeIfMatch(PARAM_RE, SemTokenType.Parameter);
      if (attempted) {
        // tryWord() can silently consume an ordinary unbound word (no call,
        // no builtin) without emitting any token for it - that's plain text
        // as far as this override is concerned, so only flush/reset the run
        // when something was actually emitted; otherwise let the run absorb
        // the silently-consumed span too.
        if (this.tokens.length > tokensBefore) {
          if (before > runStart) this.emitToken(runStart, before, SemTokenType.PlainOverride);
          runStart = f.pos;
        }
        continue;
      }
      f.pos += 1;
    }
    if (f.pos > runStart) this.emitToken(runStart, f.pos, SemTokenType.PlainOverride);
    return true;
  }

  private consumeMatch(re: RegExp, type: SemTokenType): void {
    const f = this.top();
    const m = this.matchStickyHere(re)!;
    this.emitToken(f.pos, f.pos + m.length, type);
    f.pos += m.length;
  }

  // ---- comments & dnl --------------------------------------------------------

  private tryComment(): boolean {
    if (this.commentsDisabled || this.commentBegin.length === 0) return false;
    if (!this.startsWithAt(this.commentBegin)) return false;
    const f = this.top();
    const start = f.pos;
    const searchFrom = f.pos + this.commentBegin.length;
    const endIdx = f.text.indexOf(this.commentEnd, searchFrom);
    let stop: number;
    if (endIdx === -1) {
      stop = f.text.length;
      this.emitDiag(start, stop, 'Comment runs to end of file without a closing delimiter; GNU m4 treats end-of-file as a newline here.', 'info');
    } else {
      stop = endIdx + this.commentEnd.length;
    }
    this.emitToken(start, stop, SemTokenType.Comment);
    f.pos = stop;
    return true;
  }

  private tryDnl(): boolean {
    const w = this.matchWordHere();
    if (w !== 'dnl') return false;
    const binding = this.currentBinding('dnl');
    if (!binding || binding.kind !== 'builtin') return false; // shadowed: let tryWord handle it normally
    const f = this.top();
    if (f.text.charAt(f.pos + 3) === '(') return false; // dnl(...) form: real m4 rejects extra args and does nothing; let tryWord classify it
    const nameStart = f.pos;
    const nameEnd = f.pos + 3;
    this.emitToken(nameStart, nameEnd, SemTokenType.Keyword);
    this.emitUsage({ start: nameStart, end: nameEnd, name: 'dnl', uri: f.uri, resolved: binding });
    const nl = f.text.indexOf('\n', nameEnd);
    const stop = nl === -1 ? f.text.length : nl + 1;
    if (nl === -1) this.emitDiag(nameStart, f.text.length, 'dnl runs to end of file without a newline; GNU m4 treats end-of-file as a newline here.', 'info');
    if (stop > nameEnd) this.emitToken(nameEnd, stop, SemTokenType.Comment);
    f.pos = stop;
    return true;
  }

  // ---- quoted strings --------------------------------------------------------

  /** Scans an already-detected quote start at the current position. Returns the
   *  inner text bounds (between the outermost delimiters) or undefined if
   *  unterminated. Recognized nested content is decorative only: no macro
   *  effects are ever applied while inside a quote (matches real m4: quoted
   *  text is data, not yet code). */
  private scanQuotedString(): { innerStart: number; innerEnd: number } | undefined {
    const f = this.top();
    const openStart = f.pos;
    const toggle = this.quoteLeft === this.quoteRight;
    this.emitToken(openStart, openStart + this.quoteLeft.length, SemTokenType.String);
    f.pos += this.quoteLeft.length;
    const innerStart = f.pos;
    let depth = 1;
    this.inQuoteDepth++;
    let runStart = f.pos;

    try {
      while (true) {
        if (f.pos >= f.text.length) {
          if (f.pos > runStart) this.emitToken(runStart, f.pos, SemTokenType.String);
          this.emitDiag(openStart, f.pos, 'Quoted string is not closed before end of file.', 'warning');
          return undefined;
        }
        if (!toggle && this.startsWithAt(this.quoteLeft)) {
          if (f.pos > runStart) this.emitToken(runStart, f.pos, SemTokenType.String);
          this.emitToken(f.pos, f.pos + this.quoteLeft.length, SemTokenType.String);
          f.pos += this.quoteLeft.length;
          depth++;
          runStart = f.pos;
          continue;
        }
        if (this.startsWithAt(this.quoteRight)) {
          if (f.pos > runStart) this.emitToken(runStart, f.pos, SemTokenType.String);
          const closeStart = f.pos;
          depth--;
          f.pos += this.quoteRight.length;
          this.emitToken(closeStart, f.pos, SemTokenType.String);
          if (depth === 0) return { innerStart, innerEnd: closeStart };
          runStart = f.pos;
          continue;
        }
        const before = f.pos;
        const tokensBefore = this.tokens.length;
        const consumed = this.tryWord(false) || this.consumeIfMatch(NUMBER_RE, SemTokenType.Number) || this.consumeIfMatch(PARAM_RE, SemTokenType.Parameter);
        if (consumed) {
          // Only break the string run if something was actually emitted:
          // tryWord silently consumes an unbound bare word, and leaving it
          // inside the run keeps the String tokens contiguous over the whole
          // body - which matters in .md.m4, where the static layer can lose
          // a multi-line string region to Markdown's begin/while blocks and
          // these semantic tokens are what repaints the content correctly.
          if (this.tokens.length > tokensBefore) {
            if (before > runStart) this.emitToken(runStart, before, SemTokenType.String);
            runStart = f.pos;
          }
          continue;
        }
        f.pos = before + 1;
      }
    } finally {
      this.inQuoteDepth--;
    }
  }

  private consumeIfMatch(re: RegExp, type: SemTokenType): boolean {
    if (!this.matchStickyHere(re)) return false;
    this.consumeMatch(re, type);
    return true;
  }

  // ---- words / macro calls --------------------------------------------------

  /** allowCall=false is used while decoratively scanning inside a quoted string:
   *  it never starts argument-list parsing, so a stray unbalanced '(' in quoted
   *  text (very common in shell code embedded in .m4 files) can never make the
   *  scanner run away looking for a ')' that isn't there - see README. */
  private tryWord(allowCall: boolean): boolean {
    const w = this.matchWordHere();
    if (!w) return false;
    const f = this.top();
    const nameStart = f.pos;
    const nameEnd = f.pos + w.length;
    const binding = this.currentBinding(w);
    const isCall = allowCall && f.text.charAt(nameEnd) === '(';

    // A name the static grammar always highlights as a builtin/directive (or,
    // for "dnl", its own keyword) regardless of live binding - if it's been
    // undefine()'d and isn't being called, the grammar's guess is now stale.
    const isStaleKeyword = !binding && !isCall && this.inQuoteDepth === 0 && this.opts.builtinSummaries.has(w);

    let tokenType: SemTokenType | undefined;
    if (binding) tokenType = binding.kind === 'builtin' ? SemTokenType.FunctionBuiltin : SemTokenType.FunctionUser;
    else if (isCall) tokenType = SemTokenType.FunctionUnknown;
    else if (isStaleKeyword) tokenType = SemTokenType.PlainOverride;

    if (tokenType !== undefined) this.emitToken(nameStart, nameEnd, tokenType);
    if (binding || isCall) this.emitUsage({ start: nameStart, end: nameEnd, name: w, uri: f.uri, resolved: binding });

    f.pos = nameEnd;

    if (isCall) {
      f.pos += 1; // consume '('
      const call = this.parseCallArgs();
      if (this.inQuoteDepth === 0 && binding?.kind === 'builtin' && this.opts.effectfulBuiltins.has(w)) {
        this.applyEffect(w, call, { nameStart, nameEnd, callEnd: f.pos });
      }
    } else if (this.inQuoteDepth === 0 && binding?.kind === 'builtin' && this.opts.effectfulBuiltins.has(w)) {
      // Bare invocation with no parens at all - a real, distinct case for
      // changequote/changecom (resets to defaults), not the same as `foo()`.
      this.applyEffect(w, { args: [], closed: true }, { nameStart, nameEnd, callEnd: nameEnd });
    } else if (isStaleKeyword && w === 'dnl') {
      // The static grammar's dnl-statement rule also swallows the rest of
      // this line as a (stale) comment-colored span. Simplification: this
      // doesn't re-scan that span for other real m4 constructs, unlike the
      // stale-`#` case - an undefined `dnl` sharing a line with something
      // else worth highlighting is a rare enough combination not to bother.
      const nl = f.text.indexOf('\n', f.pos);
      const end = nl === -1 ? f.text.length : nl;
      if (end > f.pos) this.emitToken(f.pos, end, SemTokenType.PlainOverride);
      f.pos = end;
    }
    return true;
  }

  /**
   * Tracks each argument's literal value incrementally, not just "is it one
   * quoted string". This matters because m4 arguments don't have to be quoted
   * at all to be literal text - e.g. the extremely common
   * `changequote([,])` idiom passes `[` and `]` completely unquoted. A
   * fragment only *disqualifies* an argument from being "known" when its
   * value genuinely can't be determined without expansion: an occurrence of
   * a currently-bound macro name (its expansion is unknown to us) or a call
   * to an unresolved name. Quoted text, literal punctuation, balanced
   * literal parens, digits, and unbound bare words are all still exact,
   * known text and are appended to the running value.
   */
  private parseCallArgs(): ParsedCall {
    const args: ParsedArg[] = [];
    let argStart = this.top().pos;
    let depth = 1;

    let litParts: string[] | undefined = [];
    let litFirst = -1;
    let litLast = -1;
    let startedContent = false;

    const disqualify = () => {
      litParts = undefined;
    };
    const contribute = (text: string, fragStart: number, fragEnd: number) => {
      if (!litParts) return;
      litParts.push(text);
      if (litFirst === -1) litFirst = fragStart;
      litLast = fragEnd;
      startedContent = true;
    };
    const pushArg = () => {
      const literal = litParts && litFirst !== -1 ? { text: litParts.join(''), innerStart: litFirst, innerEnd: litLast } : litParts ? { text: '', innerStart: argStart, innerEnd: argStart } : undefined;
      args.push({ literal });
    };
    const resetArg = () => {
      litParts = [];
      litFirst = -1;
      litLast = -1;
      startedContent = false;
    };

    while (true) {
      if (this.isEOF()) {
        pushArg();
        this.emitDiag(argStart, this.top().pos, 'Macro call is not closed before end of file.', 'warning');
        return { args, closed: false };
      }
      if (this.tryComment()) {
        disqualify(); // comments are copied verbatim to real m4's output too, but tracking that is not worth the complexity here
        continue;
      }
      if (this.tryDnl()) {
        disqualify();
        continue;
      }
      if (this.quoteLeft.length > 0 && this.startsWithAt(this.quoteLeft)) {
        const result = this.scanQuotedString();
        if (result) {
          const f = this.top();
          contribute(f.text.slice(result.innerStart, result.innerEnd), result.innerStart, result.innerEnd);
        } else {
          disqualify();
        }
        continue;
      }
      const f = this.top();
      const ch = f.text.charAt(f.pos);
      if (ch === '(') {
        depth++;
        contribute(ch, f.pos, f.pos + 1);
        f.pos++;
        continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) {
          pushArg();
          f.pos++;
          return { args, closed: true };
        }
        contribute(ch, f.pos, f.pos + 1);
        f.pos++;
        continue;
      }
      if (ch === ',' && depth === 1) {
        pushArg();
        f.pos++;
        argStart = f.pos;
        resetArg();
        continue;
      }
      if (WHITESPACE_RE.test(ch)) {
        if (startedContent) contribute(ch, f.pos, f.pos + 1); // internal/trailing whitespace is literal
        f.pos++; // leading whitespace at the start of an argument is discarded, matching m4's own argument collection
        continue;
      }
      const wordStart = f.pos;
      const w = this.matchWordHere();
      if (w) {
        const boundBefore = this.currentBinding(w);
        const isCallBefore = f.text.charAt(f.pos + w.length) === '(';
        this.tryWord(true);
        if (!boundBefore && !isCallBefore) contribute(w, wordStart, f.pos);
        else disqualify();
        continue;
      }
      if (this.matchStickyHere(NUMBER_RE)) {
        const before = f.pos;
        this.consumeMatch(NUMBER_RE, SemTokenType.Number);
        contribute(f.text.slice(before, f.pos), before, f.pos);
        continue;
      }
      if (this.matchStickyHere(PARAM_RE)) {
        const before = f.pos;
        this.consumeMatch(PARAM_RE, SemTokenType.Parameter);
        contribute(f.text.slice(before, f.pos), before, f.pos);
        continue;
      }
      contribute(ch, f.pos, f.pos + 1);
      f.pos++;
    }
  }

  // ---- effects of define/undefine/pushdef/popdef/changequote/changecom/changeword/include ----

  private applyEffect(name: string, call: ParsedCall, loc: { nameStart: number; nameEnd: number; callEnd: number }): void {
    switch (name) {
      case 'define':
      case 'pushdef':
        this.effectDefine(name, call);
        break;
      case 'undefine':
      case 'popdef':
        this.effectUndefine(name, call);
        break;
      case 'changequote':
        this.effectChangequote(call);
        break;
      case 'changecom':
        this.effectChangecom(call);
        break;
      case 'changeword':
        this.effectChangeword(call, loc);
        break;
      case 'include':
      case 'sinclude':
        this.effectInclude(name, call, loc);
        break;
    }
  }

  private effectDefine(name: 'define' | 'pushdef', call: ParsedCall): void {
    const nameArg = call.args[0]?.literal;
    if (!nameArg || !this.validNameRe.test(nameArg.text)) return;
    const bodyArg = call.args[1]?.literal;
    const uri = this.top().uri;
    const frame: MacroDefFrame = {
      kind: 'user',
      body: call.args.length >= 2 ? bodyArg?.text : '',
      declUri: uri,
      declNameStart: nameArg.innerStart,
      declNameEnd: nameArg.innerEnd,
    };
    this.pushOrReplace(nameArg.text, frame, name === 'pushdef');
    this.emitTokenReplacing(nameArg.innerStart, nameArg.innerEnd, SemTokenType.MacroDecl);
    this.emitDecl({ name: nameArg.text, nameStart: nameArg.innerStart, nameEnd: nameArg.innerEnd, uri, kind: name, bodyPreview: frame.body });
    // Records a fresh usage over the declaration's own name, so hovering it shows
    // the definition that was just made (rather than, if it happened to already
    // be bound to something, whatever the decorative pre-effect scan captured).
    this.emitUsage({ start: nameArg.innerStart, end: nameArg.innerEnd, name: nameArg.text, uri, resolved: frame });
  }

  private effectUndefine(name: 'undefine' | 'popdef', call: ParsedCall): void {
    for (const arg of call.args) {
      const lit = arg.literal;
      if (!lit || !this.validNameRe.test(lit.text)) continue;
      this.emitTokenReplacing(lit.innerStart, lit.innerEnd, SemTokenType.MacroUndecl);
      if (name === 'undefine') this.symtab.delete(lit.text);
      else this.popOne(lit.text);
    }
  }

  private effectChangequote(call: ParsedCall): void {
    if (call.args.length === 0) {
      this.quoteLeft = '`';
      this.quoteRight = "'";
      return;
    }
    const l = call.args[0]?.literal;
    if (l === undefined) return; // computed argument: can't know the new quotes
    let rq: string;
    if (call.args.length >= 2) {
      const r = call.args[1]?.literal;
      if (r === undefined) return;
      rq = l.text !== '' && r.text === '' ? "'" : r.text;
    } else {
      rq = "'";
    }
    this.quoteLeft = l.text;
    this.quoteRight = rq;
  }

  private effectChangecom(call: ParsedCall): void {
    if (call.args.length === 0) {
      this.commentsDisabled = true;
      return;
    }
    const b = call.args[0]?.literal;
    if (b === undefined) return;
    if (b.text === '') {
      // Real m4 would set an empty begin-comment string, which pathologically
      // matches at every position. We deliberately collapse that edge case to
      // "comments disabled" instead - see README.
      this.commentsDisabled = true;
      return;
    }
    let ec: string;
    if (call.args.length >= 2) {
      const e = call.args[1]?.literal;
      if (e === undefined) return;
      ec = e.text === '' ? '\n' : e.text;
    } else {
      ec = '\n';
    }
    this.commentsDisabled = false;
    this.commentBegin = b.text;
    this.commentEnd = ec;
  }

  private effectChangeword(call: ParsedCall, loc: { nameStart: number; callEnd: number }): void {
    if (call.args.length === 0) return; // bad_argc in real m4: needs exactly one argument
    const r = call.args[0]?.literal;
    if (r === undefined) return;
    if (r.text === '') {
      this.wordRegex = makeDefaultWordRegex(this.unicodeIdentifiers);
      return;
    }
    try {
      this.wordRegex = new RegExp(r.text, 'y');
    } catch {
      this.emitDiag(
        loc.nameStart,
        loc.callEnd,
        "changeword's regular expression could not be translated to a JavaScript RegExp; keeping the previous word pattern. GNU m4 uses POSIX extended regular expressions, which are not always representable in JavaScript regex syntax.",
        'info'
      );
    }
  }

  private effectInclude(name: 'include' | 'sinclude', call: ParsedCall, loc: { nameStart: number; callEnd: number }): void {
    const arg = call.args[0]?.literal;
    if (!arg) return;
    if (this.frames.length >= this.opts.maxIncludeDepth + 1) {
      this.emitDiag(loc.nameStart, loc.callEnd, `Not following ${name}("${arg.text}"): maximum include depth (${this.opts.maxIncludeDepth}) reached.`, 'info');
      return;
    }
    const baseDir = this.top().baseDir;
    const resolved = this.opts.resolveAndRead(arg.text, baseDir);
    if (!resolved) {
      if (name === 'include') this.emitDiag(loc.nameStart, loc.callEnd, `Cannot find include file "${arg.text}".`, 'warning');
      return;
    }
    if (this.activeIncludePaths.has(resolved.absPath)) {
      this.emitDiag(loc.nameStart, loc.callEnd, `Circular include of "${arg.text}" detected; not following it again.`, 'warning');
      return;
    }
    this.activeIncludePaths.add(resolved.absPath);
    this.frames.push({
      uri: 'file://' + resolved.absPath,
      text: resolved.text,
      pos: 0,
      baseDir: path.dirname(resolved.absPath),
      absPath: resolved.absPath,
    });
  }
}

function rootTextStepBudget(length: number): number {
  // Every step consumes at least one character from *some* frame, so this is
  // already a generous bound; it only bites on truly pathological / buggy
  // input, as a last-resort safety net against a hand-rolled scanner hanging.
  return Math.max(200_000, length * 8);
}
