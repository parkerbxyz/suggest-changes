# Testing

This directory contains tests for the suggest-changes action using Node.js built-in `node:test` module.

## Test files

### `unit.test.js`

- **Purpose**: Unit testing for the main `run` function with mocked dependencies
- **Approach**: Tests the complete workflow with controlled inputs and mocked Octokit
- **Test Cases**: Empty diffs, comment generation, duplicate detection
- **Dependencies**: Uses simplified mocks to isolate the core logic

### `integration.test.js`

- **Purpose**: Integration testing for suggestion generation from real fixtures
- **Approach**: Uses native Node.js snapshot capabilities to verify suggestion comments generated from actual before/after file pairs
- **Test Cases**: Full end-to-end testing of diff generation and suggestion creation
- **Dependencies**: Imports real functions from `index.js` and uses shared `getGitDiff` utility

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

The integration tests automatically discover all tool directories and before/after file pairs, making it easy to add new linters and test cases.

## Running tests

```shell
npm test
```

This will run all test files using the Node.js built-in test runner with native snapshot support.

```shell
npm test -- test/unit.test.js        # Run only unit tests
npm test -- test/integration.test.js # Run only integration tests
```

## Adding new test cases

To add tests for a new linter/formatter:

1. Create a new directory: `fixtures/[tool-name]/`
2. Add before/after file pairs following the naming pattern: `before.ext` and `after.ext`
3. Optionally add a `README.md` documenting what issues are tested

Tests will automatically discover and run the new fixtures.
