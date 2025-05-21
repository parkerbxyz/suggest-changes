# Changelog

## [2.0.1](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.0...v2.0.1) (2025-05-21)


### Bug Fixes

* **deps:** bump @actions/core from 1.10.1 to 1.11.1 ([#54](https://github.com/parkerbxyz/suggest-changes/issues/54)) ([5956d57](https://github.com/parkerbxyz/suggest-changes/commit/5956d57522bccf7bca944b66fd620c4456ba1c6a))
* **deps:** bump @octokit/action from 7.0.0 to 7.0.2 ([#65](https://github.com/parkerbxyz/suggest-changes/issues/65)) ([f28cbc6](https://github.com/parkerbxyz/suggest-changes/commit/f28cbc6561399ec729ee3ed5a9623619f44961c0))
* **deps:** bump @octokit/action from 7.0.2 to 8.0.1 ([#67](https://github.com/parkerbxyz/suggest-changes/issues/67)) ([3cb876e](https://github.com/parkerbxyz/suggest-changes/commit/3cb876e81b6c58f1008f67f81bc2fd5c7f14af0f))
* **deps:** bump @octokit/request-error in the npm_and_yarn group ([#59](https://github.com/parkerbxyz/suggest-changes/issues/59)) ([459712e](https://github.com/parkerbxyz/suggest-changes/commit/459712ee6d904111222530ad28ff6cd8a4218e56))
* **deps:** bump parse-git-diff from 0.0.16 to 0.0.17 ([#56](https://github.com/parkerbxyz/suggest-changes/issues/56)) ([e512b94](https://github.com/parkerbxyz/suggest-changes/commit/e512b942606c6d2f610591e04aec16381be5cc24))
* **deps:** bump parse-git-diff from 0.0.17 to 0.0.19 ([#66](https://github.com/parkerbxyz/suggest-changes/issues/66)) ([be08133](https://github.com/parkerbxyz/suggest-changes/commit/be0813317ed5d5a000a78a339576d98ef17fb650))
* **deps:** bump undici from 5.28.4 to 5.29.0 in the npm_and_yarn group ([#68](https://github.com/parkerbxyz/suggest-changes/issues/68)) ([815b64b](https://github.com/parkerbxyz/suggest-changes/commit/815b64b76a8e8e3439f2c74091ca665b8ff73656))

## [2.0.0](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.8...v2.0.0) (2024-10-30)


### ⚠ BREAKING CHANGES

* Changes the default pull request review action from `REQUEST_CHANGES` to `COMMENT`.

### Features

* Add pull request review event input ([#51](https://github.com/parkerbxyz/suggest-changes/issues/51)) ([12a43fe](https://github.com/parkerbxyz/suggest-changes/commit/12a43fe109109fb30da138552a09110aaa05fbc2))

## [1.0.8](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.7...v1.0.8) (2024-10-10)


### Bug Fixes

* **deps:** bump parse-git-diff from 0.0.15 to 0.0.16 ([#40](https://github.com/parkerbxyz/suggest-changes/issues/40)) ([c354849](https://github.com/parkerbxyz/suggest-changes/commit/c35484939d5468a93d4c281bff5fa1e67a8339ec))
* generate diffs with one line of context ([#49](https://github.com/parkerbxyz/suggest-changes/issues/49)) ([994b05c](https://github.com/parkerbxyz/suggest-changes/commit/994b05c86015100c4eda318cb65edfad5dfc381c))

## [1.0.7](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.6...v1.0.7) (2024-10-10)


### Bug Fixes

* do not create duplicate review comments ([#38](https://github.com/parkerbxyz/suggest-changes/issues/38)) ([6417856](https://github.com/parkerbxyz/suggest-changes/commit/6417856286dbc2a7fea6ec6d01744762e6bd9b5f))
* single line comment logic ([#45](https://github.com/parkerbxyz/suggest-changes/issues/45)) ([65a157c](https://github.com/parkerbxyz/suggest-changes/commit/65a157c51fe70f67e0e3b509f54731d495119987))

## [1.0.6](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.5...v1.0.6) (2024-08-30)


### Bug Fixes

* only select diff lines ([#34](https://github.com/parkerbxyz/suggest-changes/issues/34)) ([ab5a7c4](https://github.com/parkerbxyz/suggest-changes/commit/ab5a7c493c9cd0fd803fc03b7dbb0b46f0fac814))

## [1.0.5](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.4...v1.0.5) (2024-06-27)


### Bug Fixes

* **deps:** bump @octokit/action from 6.1.0 to 7.0.0 ([#30](https://github.com/parkerbxyz/suggest-changes/issues/30)) ([77b01ff](https://github.com/parkerbxyz/suggest-changes/commit/77b01ff6a926cf69c20028f148abee77d78090f4))
* support diffs that change single line ([#31](https://github.com/parkerbxyz/suggest-changes/issues/31)) ([f45bf47](https://github.com/parkerbxyz/suggest-changes/commit/f45bf47bb83a2b96a4fe053751de48719e3cec37))

## [1.0.4](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.3...v1.0.4) (2024-04-09)


### Bug Fixes

* **build:** revert change from ncc to esbuild ([#26](https://github.com/parkerbxyz/suggest-changes/issues/26)) ([74ce367](https://github.com/parkerbxyz/suggest-changes/commit/74ce367024c362b52830e597181144172a4c6b97))

## [1.0.3](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.2...v1.0.3) (2024-04-07)


### Bug Fixes

* **deps:** bump @octokit/action from 6.0.7 to 6.1.0 ([#21](https://github.com/parkerbxyz/suggest-changes/issues/21)) ([c35d8ba](https://github.com/parkerbxyz/suggest-changes/commit/c35d8ba468a10051e523f4382e5706beac22fd33))

## [1.0.2](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.1...v1.0.2) (2024-04-04)


### Bug Fixes

* **deps:** bump undici from 5.28.3 to 5.28.4 ([#16](https://github.com/parkerbxyz/suggest-changes/issues/16)) ([0095e09](https://github.com/parkerbxyz/suggest-changes/commit/0095e0925aae1f8c355dc7bb679235a6eba8db04))

## [1.0.1](https://github.com/parkerbxyz/suggest-changes/compare/v1.0.0...v1.0.1) (2024-03-09)


### Bug Fixes

* **deps:** bump @octokit/action from 6.0.6 to 6.0.7 ([#11](https://github.com/parkerbxyz/suggest-changes/issues/11)) ([7585a75](https://github.com/parkerbxyz/suggest-changes/commit/7585a75a2cd7c63ad003c8d5f8f33a3cd9822a5b))
* **deps:** bump parse-git-diff from 0.0.14 to 0.0.15 ([#10](https://github.com/parkerbxyz/suggest-changes/issues/10)) ([fe33cd9](https://github.com/parkerbxyz/suggest-changes/commit/fe33cd9289da812497ed627fb0977dfc4a985774))
