# Headings should not have punctuation.

There are many blank lines between this sentence and the heading above.

- This line is fine.
- This line has a trailing space that should be removed.
- There are too many empty lines between this line and the heading below.

## Headings should not have a trailing space

This line is fine.

## Headings should be surrounded by blank lines

This line should not be on the line right below the heading.

### Complex nested lists with formatting issues

- Item 1
- Item 2
- Item 3
  - Item 3.1
  - Item 3.2
    - Deep nesting with wrong indentation
      - Even deeper nesting
    - Back to third level
- [ ] Task with wrong indentation
  - [ ] Sub-task with mixed spaces and tabs
  - [ ] Another sub-task with trailing spaces
    - [ ] Deep task nesting

### Multi-line content sections

This is a paragraph with content.

Another paragraph after too many blank lines.

### Code blocks and special formatting

```javascript
// Code block example
function example() {
  return 'test'
}
```

More content here.

_This is italicized._

_Be sure to use consistent syntax for italics._
