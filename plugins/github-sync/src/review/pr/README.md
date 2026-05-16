# GitHub Sync PR review UI ownership

The built-in GitHub Sync plugin owns the runtime PR review container in this directory. It is registered from `plugins/github-sync/src/index.ts` as `plugin:com.openforge.github-sync:pr_review`.

Reusable PR review leaf UI lives in the shared workspace package `@openforge/pr-review-ui` (`packages/pr-review-ui/src`). Do not add a parallel host-app PR review copy under `src/components/review/pr`; changes to GitHub Sync PR review behavior should be made in this plugin container or the shared package, depending on whether the behavior is plugin-specific or reusable UI.
