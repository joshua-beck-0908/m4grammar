changequote(⟦,⟧)dnl
changecom(⟦<!--⟧,⟦-->⟧)dnl
dnl The two lines above are the recommended preamble for any .md.m4 file -
dnl see README.md for exactly why. Available as the m4md-preamble snippet.
dnl The ⟦ ⟧ quote pair (U+27E6/U+27E7) is registered as a matching bracket
dnl pair, so Ctrl+Shift+\ jumps between the two ends of any quoted string.
dnl (The [[double bracket]] convention from earlier versions still works.)
define(⟦PROJECT⟧, ⟦Fenceworks⟧)dnl
define(⟦VERSION⟧, ⟦3.2.0⟧)dnl
dnl
dnl Trade-off worth knowing: with the default #/newline comment, Markdown
dnl headings were accidentally protected from macro expansion (a heading IS
dnl a comment to m4). Switching comments to <!-- --> above means headings
dnl now participate in expansion like everything else - which is what we
dnl want here, since the heading below expands PROJECT/VERSION on purpose.
PROJECT VERSION
================

Welcome to PROJECT's documentation.

Below, every bare (unquoted) occurrence of ⟦PROJECT⟧ or ⟦VERSION⟧ - like
the two just above, in the title and the greeting - gets replaced by their
defined values when this file is run through m4. m4 has no idea what
Markdown is, so this works the same inside headings, prose, and even fenced
code blocks: the install command's URL always tracks whatever ⟦PROJECT⟧ is
currently defined as, on purpose. If you want a macro's name to display
literally instead of expanding - the way ⟦PROJECT⟧ and ⟦VERSION⟧ just
did, right here in this paragraph - quote it with m4's own quote characters.

## Installation

```sh
curl -sSL https://example.org/PROJECT/install.sh | sh
```

<!-- This whole block is hidden from the rendered Markdown, and is *also*
     an m4 comment now (see the changecom call up top), so a bare PROJECT
     is not expanded in here either. -->

## Changelog

- VERSION is the current release.
- Issue #123 is now just plain prose text: the # character has no special
  meaning to m4 any more, since we moved comments to <!-- -->.
