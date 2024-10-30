# Suggest changes

This GitHub Action takes changes from the working directory (using `git diff`) and applies them as suggested changes in a pull request review. This can be useful after running a linter or formatter that automatically makes fixes for you.

- Gives contributors an opportunity to review and accept automated changes
- Enables semi-automated changes to pull requests without the needing to use a personal access token (PAT) or [GitHub App installation token](https://github.com/actions/create-github-app-token) to trigger workflow runs

> [!NOTE]
> This GitHub Action only works on [`pull_request`](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#pull_request) workflow events.

## Usage

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
      - uses: DavidAnson/markdownlint-cli2-action@v15
        with:
          fix: true
          globs: '**/*.md'
      - uses: parkerbxyz/suggest-changes@v1
        with:
          comment: 'Please commit the suggested changes from markdownlint.'
          event: 'REQUEST_CHANGES'
```

> [!NOTE]
> Suggested changes are limited to [3000 files per pull request](https://docs.github.com/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests-files)

Here is what an automated pull request review with suggested changes would look like using the workflow configuration above:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/parkerbxyz/suggest-changes/assets/17183625/7657671b-35ba-4609-8031-8dc88a6e75e8">
  <img alt="A screenshot showing an automated pull request review with suggested changes" src="https://github.com/parkerbxyz/suggest-changes/assets/17183625/b59e0b60-162f-47ef-8c18-4e5ea11fb175">
</picture>
