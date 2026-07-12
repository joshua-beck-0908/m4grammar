divert(-1)
# This header is a real m4 comment: m4 copies it to the output
# byte-for-byte, it just isn't macro-expanded.
dnl Whereas this whole line, starting at `dnl', is thrown away entirely
dnl (including this trailing text) -- nothing here reaches the output.

define(`double', `eval(($1) * 2)')dnl a builtin macro body, deferred
define(`greet', `Hello, $1! You are caller number $#.')dnl

pushdef(`stack_demo', `outer `nested `deeply nested' quoting' works')dnl

ifelse(`$#', `0',
  ``no arguments were given'',
  ``got $# argument(s): $*'')dnl

dnl GNU m4 lets you rebind the quote/comment/word characters at runtime.
dnl Static syntax highlighting cannot follow a change like the one below;
dnl see the README for why that is fundamentally not fixable here.
changequote([,])dnl
define([bracket_quoted], [this body now uses square-bracket quoting])dnl
changequote(`,')dnl back to the default quote characters

eval(1 + 2 * 0x10 - 0b101)

double(21)
greet(`World')
undefined_bareword_is_just_text
divert(0)dnl
