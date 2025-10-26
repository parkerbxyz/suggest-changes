# Suggest changes

This GitHub Action takes changes from the working directory (using `git diff`) and applies them as suggested changes in a pull request review. This can be useful after running a linter or formatter that automatically makes fixes for you.

- Gives contributors an opportunity to review and accept automated changes.
- Enables semi-automated changes to pull requests without needing to use a personal access token (PAT) or [GitHub App installation token](https://github.com/actions/create-github-app-token) to trigger workflow runs.

## Quickstart

Add this step to your workflow after a step that modifies files:

```yaml
- uses: parkerbxyz/suggest-changes@v3
```

> [!IMPORTANT]
> This GitHub Action works on [`pull_request`](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) and [`pull_request_target`](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target) events.

## Usage

### Basic example

Here's a minimal example showing how to use this action:

```yaml
on:
  pull_request:

permissions:
  contents: read # Needed for actions/checkout
  pull-requests: write # Needed for this action

jobs:
  suggest-changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # Make some changes to files here
      # (e.g., run a linter or formatter)

      - uses: parkerbxyz/suggest-changes@v3
```

### Complete example

Here's a complete workflow that runs markdownlint and suggests changes when fixes are made:

```yaml
name: 'markdownlint'

on:
  pull_request:
    paths: ['**/*.md']

permissions:
  contents: read # Needed for actions/checkout
  pull-requests: write # Needed for this action

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: DavidAnson/markdownlint-cli2-action@v20
        id: markdownlint
        with:
          fix: true
          globs: '**/*.md'

      # Check if markdownlint made any fixes
      - uses: tj-actions/verify-changed-files@v20
        id: verify-changed-files
        if: always() && steps.markdownlint.outcome != 'skipped'
        with:
          # Fail if files were changed (this indicates there are linting errors to fix)
          fail-if-changed: 'true'

      # Suggest fixes if any were made
      - uses: parkerbxyz/suggest-changes@v3
        if: failure() && steps.verify-changed-files.outcome == 'failure'
        with:
          comment: 'Please commit the suggested changes from markdownlint.'
          event: 'REQUEST_CHANGES'
```

## Inputs

All inputs are optional.

### `comment`

**Default:** none

The pull request review comment that will be displayed at the top of the review.

### `event`

**Default:** `COMMENT`

The review action to perform. Options: `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.

> [!NOTE]
> Using `REQUEST_CHANGES` will block the pull request from being merged until the review is dismissed or the same reviewer approves the changes.

### `token`

**Default:** `${{ github.token }}`

Access token to make authenticated API calls. When using the default `GITHUB_TOKEN`, ensure the `pull-requests: write` permission is set in your workflow.

## Pull requests from forks

The default `GITHUB_TOKEN` has read-only permissions for pull requests from forks and cannot create review comments. There are two solutions:

### Option 1: Use a GitHub App token (recommended)

The `pull_request` event is recommended for most use cases. When triggered from a fork, you can use a [GitHub App token](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow) instead of the default `GITHUB_TOKEN`:

```yaml
on:
  pull_request:

jobs:
  suggest-changes:
    runs-on: ubuntu-latest
    permissions:
      contents: read # Needed for actions/checkout
    steps:
      - uses: actions/checkout@v5

      # Run your linter or formatter here
      # Example: markdownlint, prettier, eslint --fix, etc.

      - name: Generate token
        id: generate-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Suggest changes
        uses: parkerbxyz/suggest-changes@v3
        with:
          token: ${{ steps.generate-token.outputs.token }}
          comment: 'Please commit the suggested changes.'
```

**Why this is recommended:** The workflow runs in the context of the fork, preventing untrusted code from accessing secrets from the base repository.

### Option 2: Use `pull_request_target` event

The `pull_request_target` event can be used to support pull requests from forks, as it grants the `GITHUB_TOKEN` write permissions even when triggered from a fork.

> [!CAUTION]
> When using `pull_request_target`, the workflow runs in the context of the base repository, not the fork. This means you should **not** check out, build, or run untrusted code from the pull request, as this could be a security risk. For more information, see GitHub's documentation on [Mitigating the risks of untrusted code checkout](https://docs.github.com/enterprise-cloud@latest/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout).

## Limitations

Limitations due to GitHub API and platform constraints:

- Suggested changes can only be applied to [files](https://github.com/orgs/community/discussions/9099) and [lines](https://github.com/orgs/community/discussions/4452) that are part of the pull request diff.
- Suggested changes are limited to [3000 files per pull request](https://docs.github.com/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests-files).
