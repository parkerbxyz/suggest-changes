# Testing

This directory contains tests for the suggest-changes action using Node.js built-in `node:test` module.

## Test files

### `unit.test.js`

- **Purpose**: Unit testing for the main `run` function with mocked dependencies
- **Approach**: Tests the complete workflow with controlled inputs and mocked Octokit
- **Test Cases**: Empty diffs, comment generation, duplicate detection
- **Dependencies**: Uses simplified mocks to isolate the core logic

### `fixtures.test.js`

- **Purpose**: Fixture-based testing for suggestion generation and application using real before/after file pairs
- **Approach**: Uses native Node.js snapshot capabilities to verify suggestion comments generated from actual fixtures
- **Test Cases**:
  - **Suggestion Generation**: Full end-to-end testing of diff generation and suggestion creation with snapshot comparison
  - **Suggestion Application**: Verifies that applying generated suggestions to the "before" state produces the "after" state, ensuring suggestions are correct and will work when applied in a PR
- **Dependencies**: Imports real functions from `index.js` and uses shared `getGitDiff` utility

The Suggestion Application tests simulate what happens when a user applies suggestions in a GitHub PR review. They:

1. Read the before/after file pairs
2. Generate suggestions from the diff
3. Apply those suggestions to the before content
4. Verify the result matches the after content

This ensures that suggestions aren't just syntactically correct, but will actually produce the desired outcome when applied.

## Test fixtures

The `fixtures/` directory is organized by tool/linter for easy expansion. Each tool gets its own subdirectory containing before/after file pairs that demonstrate the formatting issues that tool would fix.

**Structure Pattern:**

```text
fixtures/
└── [tool-name]/
    ├── before.[ext]           # File with formatting issues
    ├── after.[ext]            # Corrected version
    └── README.md              # Documentation of issues tested
```

The fixture tests automatically discover all tool directories and before/after file pairs, making it easy to add new linters and test cases.

## Running tests

```shell
npm test
```

This will run all test files using the Node.js built-in test runner with native snapshot support.

```shell
npm test -- test/unit.test.js     # Run only unit tests
npm test -- test/fixtures.test.js # Run only fixture tests
```

## Adding new test cases

To add tests for a new linter/formatter:

1. Create a new directory: `fixtures/[tool-name]/`
2. Add before/after file pairs following the naming pattern: `before.ext` and `after.ext`
3. Optionally add a `README.md` documenting what issues are tested

Tests will automatically discover and run the new fixtures.
