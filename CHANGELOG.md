# Changelog

## [1.7.0](https://github.com/mclgoerg/mailbroom/compare/v1.6.0...v1.7.0) (2026-10-08)


### Features

* accessibility and polish across the UI ([#100](https://github.com/mclgoerg/mailbroom/issues/100)) ([4148a10](https://github.com/mclgoerg/mailbroom/commit/4148a108d3728e06030fbf6aebdf1dc6e412b37a))
* clearer focus and disabled states, groundwork for the UI refresh ([#91](https://github.com/mclgoerg/mailbroom/issues/91)) ([fa9f510](https://github.com/mclgoerg/mailbroom/commit/fa9f510d5eca1dd739a95310a773590ae669964a))
* clearer settings layout and filter builder ([#99](https://github.com/mclgoerg/mailbroom/issues/99)) ([a6917a6](https://github.com/mclgoerg/mailbroom/commit/a6917a621d7ae627426e1d561c1f2d68dcb83acd))
* clearer, safer destructive actions with in-app confirmations ([#97](https://github.com/mclgoerg/mailbroom/issues/97)) ([83e877f](https://github.com/mclgoerg/mailbroom/commit/83e877f8e6e3c16a293ea675f631c6dbbdbc8c14))
* compact dates and a cleaner group table ([#95](https://github.com/mclgoerg/mailbroom/issues/95)) ([b2e7a62](https://github.com/mclgoerg/mailbroom/commit/b2e7a624ddcf4e5bafa6e02384278cf7d8d5088c))
* compact, consistent mail lists in all panels ([#98](https://github.com/mclgoerg/mailbroom/issues/98)) ([5e414f3](https://github.com/mclgoerg/mailbroom/commit/5e414f3222b8127e9433be0ad43d4bb840a5747c))
* flat all-mails view like a classic mail client ([#83](https://github.com/mclgoerg/mailbroom/issues/83)) ([763f8aa](https://github.com/mclgoerg/mailbroom/commit/763f8aa918eaaf98512f5b0885eb7d2a5675055f))
* group mails by conversation thread ([#84](https://github.com/mclgoerg/mailbroom/issues/84)) ([abb945e](https://github.com/mclgoerg/mailbroom/commit/abb945ef96784547fa38f45ae84b1dce380ed2d1))
* harmonize the UI onto a layered type and spacing scale ([#92](https://github.com/mclgoerg/mailbroom/issues/92)) ([7e13567](https://github.com/mclgoerg/mailbroom/commit/7e13567444f46854daebbb953b7ac9f34aae24a2))
* opt-in local mail-text search index with keyed word hashes ([#87](https://github.com/mclgoerg/mailbroom/issues/87)) ([de3c28c](https://github.com/mclgoerg/mailbroom/commit/de3c28cac0919366bc5f645a0cd684e4a9b66e25))
* optional server-side body search with a per-account setting ([#82](https://github.com/mclgoerg/mailbroom/issues/82)) ([b4c5a2c](https://github.com/mclgoerg/mailbroom/commit/b4c5a2cd301c7b53a33db9191b262e6e9bdea38b))
* per-group engagement score with sort and eng: filter ([#79](https://github.com/mclgoerg/mailbroom/issues/79)) ([1e74dce](https://github.com/mclgoerg/mailbroom/commit/1e74dce931265c60a8420df6e0a66cddd99a8d6b))
* pin single mails so no bulk action, rule, or AI pick can delete them ([#77](https://github.com/mclgoerg/mailbroom/issues/77)) ([edfc0c4](https://github.com/mclgoerg/mailbroom/commit/edfc0c4b25c62693d046d83eda71789f812de6ae))
* read a conversation as one thread, including your own replies from Sent ([#86](https://github.com/mclgoerg/mailbroom/issues/86)) ([b2280b9](https://github.com/mclgoerg/mailbroom/commit/b2280b9050a76e3933dc88d8131368c6cad9042d))
* side-by-side group details on wide screens ([#101](https://github.com/mclgoerg/mailbroom/issues/101)) ([0fc75b5](https://github.com/mclgoerg/mailbroom/commit/0fc75b5fa31a13ac8b763e0baaf06bbb0cb40028))
* tidier toolbar with a labelled Tools menu ([#94](https://github.com/mclgoerg/mailbroom/issues/94)) ([0bd30ca](https://github.com/mclgoerg/mailbroom/commit/0bd30ca468a765a51eb6f4a77ccc5b7741ebe148))
* visible result toasts with undo, clearer status and progress ([#93](https://github.com/mclgoerg/mailbroom/issues/93)) ([dfaea61](https://github.com/mclgoerg/mailbroom/commit/dfaea61838d680513121d53524f98790df6d2a4a))


### Bug Fixes

* account menu no longer hidden behind the table header ([#90](https://github.com/mclgoerg/mailbroom/issues/90)) ([483f1b7](https://github.com/mclgoerg/mailbroom/commit/483f1b7fdf8ad58098149805042c84582a5fa377))
* don't write the full digest recipient address to the server log ([#104](https://github.com/mclgoerg/mailbroom/issues/104)) ([dc003a4](https://github.com/mclgoerg/mailbroom/commit/dc003a4f8ccf9d0c14a12104f097fe98f2f868bc))
* open conversations much faster ([#88](https://github.com/mclgoerg/mailbroom/issues/88)) ([c35941e](https://github.com/mclgoerg/mailbroom/commit/c35941eab1bbda298c6b020ad7fa1fd1a745826d))
* restored mails reappear after undo without a manual rescan ([#80](https://github.com/mclgoerg/mailbroom/issues/80)) ([9333a29](https://github.com/mclgoerg/mailbroom/commit/9333a29644eb1d9e4c1297a09bfe343fd06a982e))
* scan mails whose headers contain raw non-ASCII characters ([#89](https://github.com/mclgoerg/mailbroom/issues/89)) ([e08c735](https://github.com/mclgoerg/mailbroom/commit/e08c73550366beceb111f335275d52882e422ffb))
* selected end segment keeps the pill's rounded corner ([#102](https://github.com/mclgoerg/mailbroom/issues/102)) ([87c9d9a](https://github.com/mclgoerg/mailbroom/commit/87c9d9a467468dafef43ea67edee3192094e4eb8))
* selection bar no longer hides the last rows; compact layout ([#96](https://github.com/mclgoerg/mailbroom/issues/96)) ([9a928d3](https://github.com/mclgoerg/mailbroom/commit/9a928d3c7cc4a8bc635ca4cc0fd4de076f68df71))
* touch targets misaligned after rotating the installed iOS PWA ([#81](https://github.com/mclgoerg/mailbroom/issues/81)) ([cb4ca44](https://github.com/mclgoerg/mailbroom/commit/cb4ca44db270c53c8bbcab6da8030992ef8c3d8e))

## [1.6.0](https://github.com/mclgoerg/mailbroom/compare/v1.5.1...v1.6.0) (2026-10-02)


### Features

* configurable auto-scan schedule per account ([#68](https://github.com/mclgoerg/mailbroom/issues/68)) ([44249c2](https://github.com/mclgoerg/mailbroom/commit/44249c2b59154a73d84c4b4190fa837b643837dd))
* incremental scanning - fetch only new/changed mail ([#66](https://github.com/mclgoerg/mailbroom/issues/66)) ([7c901d8](https://github.com/mclgoerg/mailbroom/commit/7c901d840c0d7d6e079e733188448d1a0c8d15da))

## [1.5.1](https://github.com/mclgoerg/mailbroom/compare/v1.5.0...v1.5.1) (2026-10-02)


### Bug Fixes

* make the new-sender window configurable from Settings ([#62](https://github.com/mclgoerg/mailbroom/issues/62)) ([fa264a5](https://github.com/mclgoerg/mailbroom/commit/fa264a5b54fd6ec87cbf94ed9ced0e2876fb75ef))
* use a dark background for the PWA home-screen icon ([#64](https://github.com/mclgoerg/mailbroom/issues/64)) ([07457fe](https://github.com/mclgoerg/mailbroom/commit/07457fe848afb5bdfbc14a99a9d5ccc7aa3d4e34))

## [1.5.0](https://github.com/mclgoerg/mailbroom/compare/v1.4.0...v1.5.0) (2026-10-02)


### Features

* contextual bulk-action bar + quick-select chips, replacing the always-visible toolbar ([#53](https://github.com/mclgoerg/mailbroom/issues/53)) ([b87f340](https://github.com/mclgoerg/mailbroom/commit/b87f3401789acd5ae2e4b7d75b29aae9d6cfb29e))
* daily or weekly activity digest email per account ([#60](https://github.com/mclgoerg/mailbroom/issues/60)) ([4695d4f](https://github.com/mclgoerg/mailbroom/commit/4695d4fe2e02f7d837f386b710f4a7b8f8a27d48))
* flag first-time senders with an is:new filter and review chip ([#61](https://github.com/mclgoerg/mailbroom/issues/61)) ([faaf986](https://github.com/mclgoerg/mailbroom/commit/faaf98671e45b08cf38ad5acb6ba9800ef5ac012))
* group rows drop inline Trash/Block/Protect for an avatar + tap-to-open-detail ([#52](https://github.com/mclgoerg/mailbroom/issues/52)) ([0fb70e9](https://github.com/mclgoerg/mailbroom/commit/0fb70e9fee77f62ba815e4927ff44dbb34e6fb8a))
* redesign the group detail view's filter/selection toolbar ([#58](https://github.com/mclgoerg/mailbroom/issues/58)) ([762a5ed](https://github.com/mclgoerg/mailbroom/commit/762a5edb76d47a2ff6a1dd688a3ec8b0257e9797))
* replace emoji icons with a lucide-react line-icon set ([#51](https://github.com/mclgoerg/mailbroom/issues/51)) ([4e4dd58](https://github.com/mclgoerg/mailbroom/commit/4e4dd5892865209c551f560a5f23284fc124fc72))
* saved filter presets as one-tap chips ([#59](https://github.com/mclgoerg/mailbroom/issues/59)) ([4656b09](https://github.com/mclgoerg/mailbroom/commit/4656b09246cef98a791240e6c3324afb870029e9))
* selection-scoped AI review and CSV export ([#54](https://github.com/mclgoerg/mailbroom/issues/54)) ([af6ae27](https://github.com/mclgoerg/mailbroom/commit/af6ae27f9ad0f216d3546b4cc257bf5786ffad6a))


### Bug Fixes

* disabled selects/inputs dim like disabled buttons ([#50](https://github.com/mclgoerg/mailbroom/issues/50)) ([a696247](https://github.com/mclgoerg/mailbroom/commit/a69624732dcc3b5ab33b612b226b4724803dbde1))
* stop sort control from floating alone with a stray gap ([#57](https://github.com/mclgoerg/mailbroom/issues/57)) ([63c7ffa](https://github.com/mclgoerg/mailbroom/commit/63c7ffae9b5e5141715872e8d9481cd64638bc24))

## [1.4.0](https://github.com/mclgoerg/mailbroom/compare/v1.3.0...v1.4.0) (2026-10-01)


### Features

* block a sender or domain in one click via a standing auto-trash rule ([#48](https://github.com/mclgoerg/mailbroom/issues/48)) ([61657f4](https://github.com/mclgoerg/mailbroom/commit/61657f4f83db38d7d58f6ba2017876f18f7a2527))
* persistent audit log of every mailbox action ([#49](https://github.com/mclgoerg/mailbroom/issues/49)) ([4044654](https://github.com/mclgoerg/mailbroom/commit/40446544605d590d619d5f6913d11ba48c2913e6))
* retention actions - keep the newest N mails or only the last N days of a group ([#47](https://github.com/mclgoerg/mailbroom/issues/47)) ([07a8f1b](https://github.com/mclgoerg/mailbroom/commit/07a8f1ba8db1f8ab84d79e54b7017c895507f32b))


### Bug Fixes

* restructure the SPA containment check as a guard clause ([#46](https://github.com/mclgoerg/mailbroom/issues/46)) ([1ee4e69](https://github.com/mclgoerg/mailbroom/commit/1ee4e691be570066fde8200cdd1c2a2fbf5acb22))
* stop the Server settings tab scrolling sideways on mobile ([#44](https://github.com/mclgoerg/mailbroom/issues/44)) ([d5b5fff](https://github.com/mclgoerg/mailbroom/commit/d5b5fffebbfcd87e84f80c9652bcde1ea8ade68b))
