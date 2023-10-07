# Suggest changes

This GitHub Action takes changes from the working directory (using `git diff`) and applies them as suggested changes in a pull request review. This can be useful after running a linter or formatter that automatically makes fixes for you.

- Gives contributors an opportunity to review and accept automated changes
- Enables semi-automated changes to pull requests without the needing to create a personal access token (PAT) or [GitHub App installation token](https://github.com/actions/create-github-app-token) to trigger workflow runs

> [!NOTE]
> Note: This GitHub Action only works on [`pull_request`](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#pull_request) workflow events.
