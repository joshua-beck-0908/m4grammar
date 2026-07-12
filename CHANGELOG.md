# Changelog

## 0.1.0

- Initial release: TextMate grammar and language configuration for GNU m4
  (`.m4`, `.m4i`, `.m4f`, `aclocal.m4`).
- Highlights: `#` comments, `dnl` statements, default `` ` '' ``-quoted
  strings (with nesting), GNU m4 builtin macros, `changequote`/`changecom`/
  `changeword`, `$1`.. `$9`/`$0`/`$#`/`$*`/`$@` parameter references, and
  numeric literals.
- Works in Jupyter notebook code cells whose language is set to M4, and in
  fenced ```` ```m4 ```` blocks in Markdown, with no extra configuration.
