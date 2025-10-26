# Suggest changes

This GitHub Action takes changes from the working directory (using `git diff`) and applies them as suggested changes in a pull request review. This can be useful after running a linter or formatter that automatically makes fixes for you.

- Gives contributors an opportunity to review and accept automated changes.
- Enables semi-automated changes to pull requests without needing to use a personal access token (PAT) or [GitHub App installation token](https://github.com/actions/create-github-app-token) to trigger workflow runs.

## Usage

> [!IMPORTANT]
> This GitHub Action works on [`pull_request`](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#pull_request) and [`pull_request_target`](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#pull_request_target) events.

### Permissions

When using the built-in `GITHUB_TOKEN` for authentication, this action requires write permissions for pull requests. Add the following to your workflow:

```yaml
permissions:
  pull-requests: write
```

### Working with pull requests from forks

#### Using the `pull_request` event

The `pull_request` event is recommended for most use cases. However, when triggered from a fork, the default `GITHUB_TOKEN` has read-only permissions and lacks the necessary write permissions to create pull request review comments.

For pull requests from forks using the `pull_request` event, you can use a [GitHub App token](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow) instead of the default `GITHUB_TOKEN`:

```yaml
on:
  pull_request:

jobs:
  suggest-changes:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Generate token
        id: generate-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Suggest changes
        uses: parkerbxyz/suggest-changes@v1
        with:
          token: ${{ steps.generate-token.outputs.token }}
```

This approach is more secure than `pull_request_target` because the workflow runs in the context of the fork. This prevents untrusted code from accessing secrets from the base repository and limits the potential impact of security issues.

#### Using the `pull_request_target` event

The `pull_request_target` event can be used to support pull requests from forks, as it grants the `GITHUB_TOKEN` write permissions even when triggered from a fork.

> [!CAUTION]
> When using `pull_request_target`, the workflow runs in the context of the base repository, not the fork. This means you should **not** check out, build, or run untrusted code from the pull request, as this could be a security risk. For more information, see GitHub's documentation on [Keeping your GitHub Actions and workflows secure](https://securitylab.github.com/research/github-actions-preventing-pwn-requests).

### Example

You can use this action in an existing workflow and have it run after a linter or formatter step. For example, if you have a workflow that runs [markdownlint](https://github.com/DavidAnson/markdownlint) on all Markdown files in a pull request, you can use this action to suggest changes to the pull request after markdownlint has run.

```yaml
name: 'markdownlint'

on:
  pull_request:
    paths: ['**/*.md']

permissions:
  contents: read
  pull-requests: write

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

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

Here is what an automated pull request review with suggested changes would look like using the workflow configuration above:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/parkerbxyz/suggest-changes/assets/17183625/7657671b-35ba-4609-8031-8dc88a6e75e8">
  <img alt="A screenshot showing an automated pull request review with suggested changes" src="https://github.com/parkerbxyz/suggest-changes/assets/17183625/b59e0b60-162f-47ef-8c18-4e5ea11fb175">
</picture>

## Limitations

Limitations due to GitHub API and platform constraints:

- Suggested changes can only be applied to [files](https://github.com/orgs/community/discussions/9099) and [lines](https://github.com/orgs/community/discussions/4452) that are part of the pull request diff.
- Suggested changes are limited to [3000 files per pull request](https://docs.github.com/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests-files).
