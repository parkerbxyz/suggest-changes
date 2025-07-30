# Markdownlint Fixtures

This directory contains test fixtures for markdownlint formatting issues that the suggest-changes action should handle.

## Test Cases

### `before.md` → `after.md`

Tests various markdown formatting issues that markdownlint typically fixes:

- **Trailing spaces**: Lines with trailing whitespace that should be removed
- **Excessive blank lines**: Multiple consecutive empty lines that should be reduced
- **Heading spacing**: Headings that need proper blank line spacing above and below
- **List indentation**: Inconsistent list item indentation
- **Mixed formatting**: Various other markdown style issues

The `before.md` file contains the problematic markdown, and `after.md` shows the corrected version. The test generates a git diff between these files and verifies that the suggest-changes action produces the expected GitHub review comments.
