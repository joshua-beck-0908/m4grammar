changequote(⟦,⟧)dnl
changecom(⟦<!--⟧,⟦-->⟧)dnl
dnl Unicode-identifier dialect (see the m4.unicodeIdentifiers setting):
dnl every non-ASCII character - equivalently, every UTF-8 byte with the
dnl high bit set - counts as an identifier character, matching wrapper
dnl scripts that extend m4 this way. Standard GNU m4 would copy these
dnl names through as plain bytes instead of expanding them.
dnl (The only exceptions are ⟦ and ⟧ themselves, which are reserved as
dnl the recommended quote delimiters - a character can't be both.)
define(⟦≡📅⟧,⟦2026-07-19⟧)dnl
define(⟦✍️author⟧,⟦Joshua Beck⟧)dnl

*Written on ≡📅 by ✍️author.*

Identifiers can mix scripts and symbols freely: ≡📅(with, args) is
highlighted as a call, and hovering any reference shows its definition.
