// Metadata about GNU m4's builtin macros, taken from src/builtin.c and doc/m4.texi
// in https://github.com/tar-mirror/gnu-m4. Only used for hover text and for deciding
// which calls the analyzer should treat as having a tracked side effect.

export interface BuiltinInfo {
  name: string;
  summary: string;
  /** True if we track this call's effect on lexer/symbol state (only when its
   *  arguments are literal quoted strings we can read without expansion). */
  hasTrackedEffect: boolean;
}

export const BUILTINS: readonly BuiltinInfo[] = [
  { name: '__file__', summary: 'Expands to the name of the current input file.', hasTrackedEffect: false },
  { name: '__line__', summary: 'Expands to the current input line number.', hasTrackedEffect: false },
  { name: '__program__', summary: 'Expands to the name of the m4 program (GNU extension).', hasTrackedEffect: false },
  { name: 'builtin', summary: 'builtin(NAME, ...) calls the builtin NAME directly, bypassing any user redefinition.', hasTrackedEffect: false },
  { name: 'changecom', summary: "changecom([BEGIN], [END]) changes the comment delimiters. With no arguments, comments are disabled entirely (this is NOT the same as changequote()'s reset-to-default).", hasTrackedEffect: true },
  { name: 'changequote', summary: 'changequote([LEFT], [RIGHT]) changes the quote delimiters. With no arguments, resets to the default `\' pair.', hasTrackedEffect: true },
  { name: 'changeword', summary: 'changeword(REGEXP) changes the regular expression used to recognize a "word" (GNU extension, only in builds configured with --enable-changeword).', hasTrackedEffect: true },
  { name: 'debugmode', summary: 'debugmode([FLAGS]) changes the format of debugging output.', hasTrackedEffect: false },
  { name: 'debugfile', summary: 'debugfile([FILE]) redirects debugging and tracing output to FILE.', hasTrackedEffect: false },
  { name: 'decr', summary: 'decr(NUM) decrements NUM by one.', hasTrackedEffect: false },
  { name: 'define', summary: 'define(NAME, [BODY]) defines or redefines the macro NAME to expand to BODY. Replaces the current binding, if any.', hasTrackedEffect: true },
  { name: 'defn', summary: 'defn(NAME, ...) returns the quoted definition(s) of the named macro(s); commonly used to save a builtin before shadowing it.', hasTrackedEffect: false },
  { name: 'divert', summary: 'divert([NUM]) redirects subsequent output to diversion NUM (0 is immediate output; negative numbers discard output).', hasTrackedEffect: false },
  { name: 'divnum', summary: 'divnum expands to the number of the current output diversion.', hasTrackedEffect: false },
  { name: 'dnl', summary: 'dnl discards all characters up to and including the next newline. Unlike a comment, the discarded text is not copied to output, and quoting has no effect on it.', hasTrackedEffect: false },
  { name: 'dumpdef', summary: 'dumpdef([NAME], ...) prints the current definitions of the named macros (or all macros) to the debug/trace output.', hasTrackedEffect: false },
  { name: 'errprint', summary: 'errprint(MESSAGE, ...) prints MESSAGE to standard error.', hasTrackedEffect: false },
  { name: 'esyscmd', summary: 'esyscmd(COMMAND) runs COMMAND via the shell and expands to its standard output (GNU extension).', hasTrackedEffect: false },
  { name: 'eval', summary: 'eval(EXPR, [RADIX], [WIDTH]) evaluates an integer arithmetic expression. Accepts decimal, 0x hex, 0b binary, leading-zero octal, and GNU-extension BASE:DIGITS literals.', hasTrackedEffect: false },
  { name: 'format', summary: 'format(FORMAT, ...) does printf(3)-style formatting (GNU extension).', hasTrackedEffect: false },
  { name: 'ifdef', summary: 'ifdef(NAME, THEN, [ELSE]) expands to THEN if NAME is currently defined, else ELSE.', hasTrackedEffect: false },
  { name: 'ifelse', summary: "ifelse(A, B, THEN, ...) compares A and B as strings; expands to THEN if equal, otherwise recurses on the remaining arguments (m4's if/switch).", hasTrackedEffect: false },
  { name: 'include', summary: 'include(FILE) inserts and processes the contents of FILE in place; an error if FILE cannot be opened.', hasTrackedEffect: true },
  { name: 'incr', summary: 'incr(NUM) increments NUM by one.', hasTrackedEffect: false },
  { name: 'index', summary: 'index(HAYSTACK, NEEDLE) returns the index of the first occurrence of NEEDLE in HAYSTACK, or -1.', hasTrackedEffect: false },
  { name: 'indir', summary: 'indir(NAME, ...) calls the macro whose name is the (possibly computed) string NAME (GNU extension).', hasTrackedEffect: false },
  { name: 'len', summary: 'len(STRING) returns the length of STRING.', hasTrackedEffect: false },
  { name: 'm4exit', summary: 'm4exit([CODE]) exits m4 immediately with the given exit code.', hasTrackedEffect: false },
  { name: 'm4wrap', summary: 'm4wrap(STRING) arranges for STRING to be pushed back and read again when the end of input is reached.', hasTrackedEffect: false },
  { name: 'maketemp', summary: 'maketemp(TEMPLATE) is a deprecated, insecure alias historically used like mkstemp.', hasTrackedEffect: false },
  { name: 'mkstemp', summary: 'mkstemp(TEMPLATE) securely creates a temporary file from a template ending in XXXXXX and expands to its name.', hasTrackedEffect: false },
  { name: 'patsubst', summary: 'patsubst(STRING, REGEXP, [REPLACEMENT]) substitutes REGEXP matches in STRING (GNU extension).', hasTrackedEffect: false },
  { name: 'popdef', summary: 'popdef(NAME, ...) removes the most recent pushdef (or define) of NAME, revealing any earlier definition.', hasTrackedEffect: true },
  { name: 'pushdef', summary: 'pushdef(NAME, [BODY]) defines NAME like define, but stacks on top of any existing definition instead of replacing it.', hasTrackedEffect: true },
  { name: 'regexp', summary: 'regexp(STRING, REGEXP, [REPLACEMENT]) matches REGEXP against STRING (GNU extension).', hasTrackedEffect: false },
  { name: 'shift', summary: 'shift(ARG1, ...) expands to its arguments, quoted and comma-separated, with the first argument removed.', hasTrackedEffect: false },
  { name: 'sinclude', summary: 'sinclude(FILE) is like include(FILE), but silently does nothing if FILE cannot be opened.', hasTrackedEffect: true },
  { name: 'substr', summary: 'substr(STRING, FROM, [LENGTH]) returns a substring of STRING.', hasTrackedEffect: false },
  { name: 'syscmd', summary: 'syscmd(COMMAND) runs COMMAND via the shell; its output goes to diversion 0, not to the macro expansion.', hasTrackedEffect: false },
  { name: 'sysval', summary: "sysval expands to the exit status of the last syscmd/esyscmd call.", hasTrackedEffect: false },
  { name: 'traceoff', summary: 'traceoff([NAME], ...) disables tracing for the named macros (or all macros).', hasTrackedEffect: false },
  { name: 'traceon', summary: 'traceon([NAME], ...) enables tracing for the named macros (or all macros).', hasTrackedEffect: false },
  { name: 'translit', summary: 'translit(STRING, FROM, [TO]) transliterates characters in STRING, like tr(1). FROM/TO may use A-Z-style ranges.', hasTrackedEffect: false },
  { name: 'undefine', summary: 'undefine(NAME, ...) removes all definitions (the entire pushdef stack) of the named macros.', hasTrackedEffect: true },
  { name: 'undivert', summary: 'undivert([NUM], ...) appends the named diversion(s) (or all of them) to the current diversion.', hasTrackedEffect: false },
];

export const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTINS.map((b) => b.name));

export const BUILTIN_INFO_BY_NAME: ReadonlyMap<string, BuiltinInfo> = new Map(
  BUILTINS.map((b) => [b.name, b])
);

/** Predefined GNU m4 macros that exist as plain string constants, not callable builtins. */
export const PREDEFINED_CONSTANTS: readonly string[] = ['__gnu__', '__unix__', '__windows__', '__os2__', 'unix', 'windows', 'os2'];
