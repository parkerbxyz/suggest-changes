# Changelog

## [3.0.4](https://github.com/parkerbxyz/suggest-changes/compare/v3.0.3...v3.0.4) (2026-02-04)


### Bug Fixes

* **deps:** bump @actions/core from 2.0.2 to 3.0.0 ([#138](https://github.com/parkerbxyz/suggest-changes/issues/138)) ([187bab0](https://github.com/parkerbxyz/suggest-changes/commit/187bab0d212609c5e57f55f63ba4a52d1e867743))
* **deps:** bump @actions/exec from 2.0.0 to 3.0.0 ([#137](https://github.com/parkerbxyz/suggest-changes/issues/137)) ([2b2677f](https://github.com/parkerbxyz/suggest-changes/commit/2b2677f506d2c73bb407cf38b101501ac94b242c))
* **deps:** bump undici and @actions/http-client ([#139](https://github.com/parkerbxyz/suggest-changes/issues/139)) ([27babf8](https://github.com/parkerbxyz/suggest-changes/commit/27babf8b13f7f37d7767213327ec13160afb2499))

## [3.0.3](https://github.com/parkerbxyz/suggest-changes/compare/v3.0.2...v3.0.3) (2026-01-13)


### Bug Fixes

* **deps:** bump @actions/core from 1.11.1 to 2.0.1 ([#132](https://github.com/parkerbxyz/suggest-changes/issues/132)) ([d12137a](https://github.com/parkerbxyz/suggest-changes/commit/d12137a270686599aa72d5fbe2885ddf2deab87d))
* **deps:** bump @actions/exec from 1.1.1 to 2.0.0 ([#131](https://github.com/parkerbxyz/suggest-changes/issues/131)) ([5d62b1a](https://github.com/parkerbxyz/suggest-changes/commit/5d62b1a4aab4e6363574cc6bc06cf1170fc9928a))
* **deps:** bump @octokit/action from 8.0.2 to 8.0.4 ([#133](https://github.com/parkerbxyz/suggest-changes/issues/133)) ([17da405](https://github.com/parkerbxyz/suggest-changes/commit/17da405677fb024c2ed3b902b1ea597167aa69f2))

## [3.0.2](https://github.com/parkerbxyz/suggest-changes/compare/v3.0.1...v3.0.2) (2025-10-25)


### Bug Fixes

* add detailed debug output for skipped duplicate suggestions ([#124](https://github.com/parkerbxyz/suggest-changes/issues/124)) ([03a1bc5](https://github.com/parkerbxyz/suggest-changes/commit/03a1bc588d2ac946dd5889166b02a26ada538b39))
* handle new files and correct line numbers in suggestions ([#115](https://github.com/parkerbxyz/suggest-changes/issues/115)) ([99cf32f](https://github.com/parkerbxyz/suggest-changes/commit/99cf32f4c82824dbd55623e39c838ccf2940b149))
* Improve grouping algorithm to handle line movements correctly ([#121](https://github.com/parkerbxyz/suggest-changes/issues/121)) ([6dc4a99](https://github.com/parkerbxyz/suggest-changes/commit/6dc4a999a3d81e51eb5d4a102a6958f690eee054))

## [3.0.1](https://github.com/parkerbxyz/suggest-changes/compare/v3.0.0...v3.0.1) (2025-10-19)


### Bug Fixes

* add draft review comments to debug logs ([#106](https://github.com/parkerbxyz/suggest-changes/issues/106)) ([5efd0b7](https://github.com/parkerbxyz/suggest-changes/commit/5efd0b75fb9df6a079b95405dd9d55ac16626f11))
* **deps:** bump @octokit/request-error from 7.0.0 to 7.0.1 ([#111](https://github.com/parkerbxyz/suggest-changes/issues/111)) ([b03f1f4](https://github.com/parkerbxyz/suggest-changes/commit/b03f1f4f4ec7b39fdf839d6a961cc473e17570d5))

## [3.0.0](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.7...v3.0.0) (2025-08-24)


### ⚠ BREAKING CHANGES

* This requires Actions Runner v2.327.1 or later if you are using a self-hosted runner.

### Features

* use `node24` runner ([#91](https://github.com/parkerbxyz/suggest-changes/issues/91)) ([b68873c](https://github.com/parkerbxyz/suggest-changes/commit/b68873c1ed30765e49eb376345ef48f1a43676be))

## [2.0.7](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.6...v2.0.7) (2025-08-24)


### Bug Fixes

* add error handling for missing `pull_request` data ([#96](https://github.com/parkerbxyz/suggest-changes/issues/96)) ([fbde3ad](https://github.com/parkerbxyz/suggest-changes/commit/fbde3ad9521f88f98dd6601a305e05a662412247))
* add info logging when duplicate suggestions are skipped ([#100](https://github.com/parkerbxyz/suggest-changes/issues/100)) ([5509aa9](https://github.com/parkerbxyz/suggest-changes/commit/5509aa9b588d8a9cd0fa023210c78d9cf37f1a6a))
* only comment on lines that are part of the pull request diff  ([#102](https://github.com/parkerbxyz/suggest-changes/issues/102)) ([d2f3ca3](https://github.com/parkerbxyz/suggest-changes/commit/d2f3ca31031d0c8b398885a81082c8bacd5cccca))

## [2.0.6](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.5...v2.0.6) (2025-08-17)


### Bug Fixes

* adjust diff handling when codestyle checkers expand lines ([#87](https://github.com/parkerbxyz/suggest-changes/issues/87)) ([68e7b97](https://github.com/parkerbxyz/suggest-changes/commit/68e7b9788007ff0ba17be78dd735a97e9fb5f64b))

## [2.0.5](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.4...v2.0.5) (2025-07-29)


### Bug Fixes

* change grouping and deletion separation logic ([#83](https://github.com/parkerbxyz/suggest-changes/issues/83)) ([bd09077](https://github.com/parkerbxyz/suggest-changes/commit/bd090778fb533b461b02565c499b0cd188f21f4b))

## [2.0.4](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.3...v2.0.4) (2025-07-29)


### Bug Fixes

* improve review comment line positioning and deleted line handling ([#81](https://github.com/parkerbxyz/suggest-changes/issues/81)) ([47649b1](https://github.com/parkerbxyz/suggest-changes/commit/47649b1df8c372a0fdc871480791e1673159b6b6))

## [2.0.3](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.2...v2.0.3) (2025-07-28)


### Bug Fixes

* improve line positioning for review comments ([#78](https://github.com/parkerbxyz/suggest-changes/issues/78)) ([c8ecf14](https://github.com/parkerbxyz/suggest-changes/commit/c8ecf14ac169d70597e47d319204f132ff47b0c9))

## [2.0.2](https://github.com/parkerbxyz/suggest-changes/compare/v2.0.1...v2.0.2) (2025-07-25)


### Bug Fixes

* **deps:** bump @octokit/action from 8.0.1 to 8.0.2 ([#71](https://github.com/parkerbxyz/suggest-changes/issues/71)) ([705eeae](https://github.com/parkerbxyz/suggest-changes/commit/705eeae2f0f3ca8fe6b0e67c20648457266f1b30))
* update suggestion line range calculation ([#72](https://github.com/parkerbxyz/suggest-changes/issues/72)) ([4492e05](https://github.com/parkerbxyz/suggest-changes/commit/4492e05c5f41709a0998515edda56c02758f9237))

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
