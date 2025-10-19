# Copilot Instructions for suggest-changes

## Project Overview

This is a GitHub Action that creates pull request review suggestions from working directory changes (via `git diff`). It's designed to work with linters and formatters that make automatic fixes, converting those fixes into suggested changes in PR reviews.

**Important constraints:**
- This action ONLY works on `pull_request` events
- Suggested changes are limited to files and lines that are part of the PR diff
- Maximum of 3000 files per pull request

## Technology Stack

- **Language:** JavaScript (ES modules)
- **Runtime:** Node.js 24.5.0 or higher
- **Package Manager:** npm 11.6.0
- **Dependencies:**
  - `@actions/core` and `@actions/exec` for GitHub Actions integration
  - `@octokit/action` for GitHub API interactions
  - `parse-git-diff` for parsing git diffs

## Coding Standards

### Code Style
- Use Prettier with the following config:
  - No semicolons (`semi: false`)
  - Single quotes (`singleQuote: true`)
- Follow existing code patterns in `index.js`

### Type Safety
- Use JSDoc type annotations for all functions (see existing patterns in `index.js`)
- Define custom types at the top of files using `@typedef`
- Use type guards for runtime type checking (e.g., `isAddedLine`, `isDeletedLine`)
- Enable TypeScript checking with `// @ts-check` at the top of files

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for type definitions
- Use descriptive names that indicate purpose

### Function Guidelines
- Write functions with clear JSDoc comments
- Keep functions focused on a single responsibility
- Handle errors appropriately with try/catch blocks
- Use early returns for error conditions

## Testing

### Test Framework
- Use Node.js built-in test runner (`node --test`)
- Tests are located in the `test/` directory

### Test Types
1. **Unit Tests** (`test/unit.test.js`): Test individual functions in isolation
2. **Integration Tests** (`test/integration.test.js`): Test end-to-end workflows with fixtures
3. **Snapshot Tests**: Use snapshot testing for complex output validation

### Test Commands
- Run tests: `npm test`
- Run with coverage: `npm run test:coverage`
- Watch mode: `npm run test:watch`
- Update snapshots: `npm run test:update-snapshots`

### Test Fixtures
- Store test fixtures in `test/fixtures/` directory
- Use realistic examples from actual linters (e.g., markdownlint, php-cs-fixer)

## Building and Distribution

- Build the action: `npm run build`
- The built action is in `dist/index.js` (using `@vercel/ncc`)
- The `dist/` directory must be committed to the repository

## GitHub API Integration

### Key Concepts
- Use `@octokit/action` for authenticated API calls
- Handle `RequestError` for API failures gracefully
- Be aware of GitHub API rate limits
- Filter suggestions to only those within the PR diff

### Common Patterns
- Get PR information from `github.event.pull_request`
- Create review comments in batches when possible
- Handle 422 errors (line outside diff) gracefully

## Error Handling

- Use `@actions/core` functions for logging:
  - `debug()` for detailed debugging information
  - `info()` for general information
  - `warning()` for non-fatal issues
  - `setFailed()` for fatal errors
- Don't fail the action if suggestions can't be made (e.g., line outside diff)
- Provide informative error messages to help users troubleshoot

## Development Workflow

1. Make minimal, focused changes
2. Run tests frequently: `npm test`
3. Build before committing: `npm run build`
4. Ensure `dist/` is updated and committed
5. Follow existing patterns and conventions
6. Write or update tests for new functionality

## Dependencies

- Always check for security vulnerabilities before adding new dependencies
- Prefer well-maintained, popular packages
- Keep dependencies up to date but test thoroughly after updates
- Use exact versions in `package.json` where appropriate
