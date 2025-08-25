# Suggest Changes GitHub Action

Suggest Changes is a GitHub Action written in JavaScript (Node.js) that takes working directory changes (using `git diff`) and applies them as suggested changes in a pull request review. This enables semi-automated code changes without requiring personal access tokens.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

Bootstrap, build, and test the repository:

- Install dependencies: `npm ci` -- takes 1 second. NEVER CANCEL. Set timeout to 30+ seconds.
- Build: `npm run build` -- takes 2-3 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Run unit tests: `npm test` -- takes 0.4 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Format code: `npx --yes prettier --write .` -- takes 4-5 seconds. Set timeout to 30+ seconds.

## System Requirements

- Node.js (version specified in `package.json` engines)
- npm (comes with Node.js)

## Build and Test Commands

**Build Process:**

- `npm ci` - Install dependencies (1 second)
- `npm run build` - Bundle with ncc into `dist/index.js` (2-3 seconds)

**Testing:**

- `npm test` - Run all tests using Node.js built-in test runner
- `npm test -- test/unit.test.js` - Run only unit tests (0.4 seconds, all pass)
- `npm test -- test/integration.test.js` - Run integration tests (has snapshot API issue but non-critical)

**Code Quality:**

- `npx --yes prettier --check .` - Check code formatting
- `npx --yes prettier --write .` - Fix code formatting automatically
- Note: `dist/index.js` is generated and may have formatting differences - this is expected

## Validation

**Always run these validation steps after making changes:**

1. Check code formatting: `npx prettier --check .`
2. Fix formatting if needed: `npx prettier --write .`
3. Build the action: `npm run build`
4. Run unit tests: `npm test -- test/unit.test.js`
5. Verify the dist files are updated correctly

**Manual Testing Scenarios:**

- The action processes git diffs and creates GitHub PR review suggestions
- Test fixtures in `test/fixtures/markdownlint/` show before/after examples
- The action handles various markdown formatting issues: trailing spaces, heading punctuation, indentation, blank lines
- You cannot run the action locally without GitHub Action environment variables (GITHUB_REPOSITORY, GITHUB_EVENT_PATH)

## Key Project Structure

**Main Files:**

- `index.js` - Main action logic with exports for testing
- `action.yml` - GitHub Action metadata and input definitions
- `dist/index.js` - Bundled action code (created by `npm run build`)

**Test Files:**

- `test/unit.test.js` - Unit tests for core functions (working)
- `test/integration.test.js` - Integration tests using test fixtures (snapshot API issue)
- `test/fixtures/markdownlint/` - Test fixtures with before/after markdown files

**Configuration:**

- `package.json` - Dependencies and scripts, includes Prettier config (no semicolons, single quotes)
- `.node-version` - Specifies Node.js 20.9.0
- `.github/workflows/test.yml` - CI workflow that runs on PRs

## Important Notes

**This is a GitHub Action, not a standalone CLI tool:**

- Designed to run in GitHub Actions workflow after linters/formatters
- Requires GitHub Action environment (cannot easily run locally)
- Creates pull request review suggestions from git diff output

**Timing Expectations:**

- Dependencies: 1 second
- Build: 2-3 seconds
- Unit tests: 0.4 seconds
- Code formatting: 4-5 seconds
- **All operations are very fast - use 30+ second timeouts to be safe**

**Code Style:**

- Uses Prettier
- Always run `npx --yes prettier --write .` before committing
- Build creates bundled `dist/index.js` that must be committed

## Common Tasks Reference

**Repository root contents:**

```
.github/          - GitHub workflows and configurations
action.yml        - GitHub Action metadata
dist/            - Bundled action code (generated)
index.js         - Main action source code
package.json     - Dependencies and scripts
test/            - Test files and fixtures
```

**Example workflow usage:**
The action is designed to run after linters like markdownlint:

```yaml
- uses: parkerbxyz/suggest-changes@v3
  with:
    comment: 'Please commit the suggested changes.'
    event: 'REQUEST_CHANGES'
```

**Test fixture structure:**

```
test/fixtures/markdownlint/
├── before.md    - File with formatting issues
├── after.md     - Corrected version
└── README.md    - Documentation of test cases
```
