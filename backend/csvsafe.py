"""Spreadsheet-safe CSV cells (OWASP "CSV injection").

Excel, LibreOffice and Sheets evaluate a text cell that starts with `=`,
`+`, `-`, `@`, TAB or CR as a formula. Several exported columns carry text
taken from mail (sender names, addresses, labels, AI reasons), so a crafted
sender name such as `=HYPERLINK(...)` would run when the export is opened.
`row()` prefixes such a string cell with a single quote, which spreadsheets
read as "this is text"; numbers and empty cells pass through unchanged.
"""

from __future__ import annotations

TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def cell(value):
    """One CSV cell: a string starting with a trigger character gets a
    leading `'`; anything else (ints and floats included, so a negative
    number stays a number) is returned as it is."""
    if isinstance(value, str) and value.startswith(TRIGGERS):
        return "'" + value
    return value


def row(values) -> list:
    """`cell()` applied to every value of one CSV row."""
    return [cell(v) for v in values]
