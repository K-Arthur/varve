# Generative editing photographic corpus — 2026-09-12

## Purpose and status

This audit freezes the real-image inputs and task definitions for the
generative-editing quality lane. The repository now contains 24 photographic
fixtures: the original 11 documented in
[`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md)
and the 13 additions below. The task manifest defines 32 tasks (eight each
for Fill, Remove, Replace, and Expand), with an explicit mask template,
prompt, and three seeds per task.

The corpus is an input qualification gate, not model-quality evidence. The
2026-09-12 runtime report records that no prompt-conditioned local model has
yet cleared the real-photo semantic/runtime gate. No output from this corpus
is presented as marketing proof until that gate passes.

The machine-readable source of truth is
[`photo-corpus-2026-09-12.json`](../../tests/e2e/fixtures/generative-evidence/photo-corpus-2026-09-12.json).
The downloaded inputs were visually inspected in the retained
[contact sheet](../../tests/e2e/fixtures/generative-evidence/photo-corpus-contact-sheet-2026-09-12.jpg).

## Added fixtures

All additions are JPEG thumbnail derivatives served by Wikimedia Commons at
1280px maximum width. Aspect ratio was retained and no image pixels were
retouched. The checksum is over the exact committed fixture bytes.

| Fixture | Source / creator | License | Source size | Fixture size | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| `real-life-beech-forest.jpg` | [Beech Forest](https://commons.wikimedia.org/wiki/File:Beech_Forest_(AU),_Great_Otway_National_Park,_Beauchamp_Falls_--_2019_--_1271.jpg) — Dietmar Rabich | CC BY-SA 4.0 | 6508×4339 | 1280×853 | `57634029987b652576224188cfe725643df6cec056e3019bd956fea48d96bc53` |
| `real-life-elephant.jpg` | [Kruger elephant](https://commons.wikimedia.org/wiki/File:Kruger_National_Park_(ZA),_Elefant_--_2024_--_0649.jpg) — Dietmar Rabich | CC BY-SA 4.0 | 6414×4276 | 1280×853 | `379667624594d2f6824711b7bc42b3786df419069a39b69699880675a9cee2f2` |
| `real-life-port-campbell-coast.jpg` | [Worm Bay](https://commons.wikimedia.org/wiki/File:Peterborough_(AU),_Port_Campbell_National_Park,_Worm_Bay_--_2019_--_0863.jpg) — Dietmar Rabich | CC BY-SA 4.0 | 6718×4479 | 1280×853 | `778e6de9cae4cffcbff7456b81665b89839ceb53997c200a09d7b44d4a5b57e3` |
| `real-life-tsitsikamma-coast.jpg` | [Tsitsikamma coast](https://commons.wikimedia.org/wiki/File:Tsitsikamma_National_Park_(ZA),_Kanus_an_der_Küste_--_2024_--_1990.jpg) — Dietmar Rabich | CC BY-SA 4.0 | 6671×4447 | 1280×853 | `415e18543e8049673a506197bf3d163949ffbbfdbf5a6de4597bc297ce16f4ec` |
| `real-life-yellowstone-spring.jpg` | [Grand Prismatic Spring](https://commons.wikimedia.org/wiki/File:Yellowstone_National_Park_(WY,_USA),_Grand_Prismatic_Spring_--_2022_--_2514.jpg) — Dietmar Rabich | CC BY-SA 4.0 | 6639×4350 | 1280×839 | `e0b6b27a867c5ee41115b6ac0b8fbf072fd348f8dcd6283bc5a5c9b1940991fb` |
| `real-life-noaa-deepwater.jpg` | [Hohonu Moana deepwater](https://commons.wikimedia.org/wiki/File:2016_Hohonu_Moana,_Exploring_Deepwaters_off_Hawaii_-_Flickr_-_NOAA_Ocean_Exploration_%5E_Research.jpg) — NOAA Ocean Exploration & Research | Public domain | 1920×1080 | 1280×720 | `1030a669ed7f9844fa94c85ec218812d04c88c7fec367dc4a3e932ce56018a03` |
| `real-life-galapagos-crab.jpg` | [Galápagos Sally lightfoot crab](https://commons.wikimedia.org/wiki/File:Grapsus_grapsus_Galapagos_Islands.jpg) — Elizabeth Crapo, NOAA Corps | Public domain | 3008×2000 | 1280×851 | `cba5ccf21cb8f09653c1d80f5816a9c0d3ee6fe1b7dcd9df4187b10abeaac64b` |
| `real-life-ocean-acidification.jpg` | [Ocean acidification with NOAA](https://commons.wikimedia.org/wiki/File:YCC_Ocean_Acidification_with_NOAA_(10952078384).jpg) — USFWSAlaska | Public domain | 4320×3240 | 1280×960 | `af9eaedb1aa442ca7ab62fcc0f6255756a37dcf7b1087142191f0e673b84ce8c` |
| `real-life-seascape-sunset.jpg` | [White seascape sunset](https://commons.wikimedia.org/wiki/File:White_seascape_sunset.jpg) — Valeria Guanquiao | Public domain | 3240×4320 | 1280×1707 | `a5b2f6bb919b31bbb536acc2e2f82c83b1c5b6384820eb6594682aeb4ae74085` |
| `real-life-bearded-man.jpg` | [Bearded man with long hair](https://commons.wikimedia.org/wiki/File:Bearded_man_with_long_hair-3052641.jpg) — subhamshome28 | CC0 | 4000×5000 | 1280×1600 | `6ee16d33183de206a8835fe3e45a78f52bc9ab07f7a7e29eb4398c1bcf5d2f38` |
| `real-life-katharine-hepburn.jpg` | [Katharine Hepburn publicity photograph](https://commons.wikimedia.org/wiki/File:Katharine_Hepburn_publicity_photograph.jpg) — Metro-Goldwyn-Mayer Studios, restored by Adam Cuerden | Public domain | 2095×2776 | 1280×1696 | `237231b4d3d0ce5d345072c7ac0a0184e9a1d05e66c115a8615f043d4e2c6169` |
| `real-life-church-interior.jpg` | [BMV Church interior](https://commons.wikimedia.org/wiki/File:Essen_Germany_Interior-of-BMV-Church-01.jpg) — CEphoto, Uwe Aranas | CC BY-SA 3.0 | 5376×3840 | 1280×914 | `f2dce00dfb7cee5e91ce8040045b567f3b680a947d9f9c17ee022513087472c5` |
| `real-life-lancaster-priory.jpg` | [Lancaster Priory interior](https://commons.wikimedia.org/wiki/File:Lancaster_Priory_Interior.jpg) — Michael D Beckwith | CC0 | 8687×5791 | 1280×853 | `fc53202c26154d68bf826bca9dfdc9a6c4c5e3ae3b40fda86f572468b0e8d95a` |

## Frozen task lane

The manifest freezes 32 tasks with eight tasks in each mode:

| Mode | Tasks | Frozen inputs |
| --- | ---: | --- |
| Fill | 8 | Promptless reconstruction masks across landscape, water, texture, still life, reflection, and interior scenes |
| Remove | 8 | Promptless background reconstruction for people, hair, wildlife, architecture, reflections, and interiors |
| Replace | 8 | Prompt-conditioned object substitutions with rectangular, elliptical, and polygonal masks |
| Expand | 8 | Prompt-conditioned bounded extensions on sides and corners without scaling the original frame |

Each task stores three fixed seeds. Masks use source-relative normalized
coordinates for bounded edits and explicit side sets for expansion. White is
the edit region and black is preserved content. The generation runner must
materialize those definitions at the fixture's decoded dimensions; it must
not use a screenshot of a preview canvas as the qualification mask.

## Qualification status

| Gate | Status |
| --- | --- |
| 24 photographic fixtures | Complete; checksums and decoded dimensions verified |
| 32 frozen tasks / three seeds | Complete; manifest validated |
| Promptless Fill/Remove outputs | Not run for this frozen corpus checkpoint |
| Genuine prompt-conditioned Fill/Replace/Expand | Blocked by the failed model qualification recorded in the [runtime report](generative-editing-runtime-qualification-2026-09-12.md) |
| 90% task success, all categories, 0–4 scoring | Outstanding |
| Cross-platform, 4 GB, cancellation, persistence, and export evidence | Outstanding |

No task is marked passed until its raw candidate, final composite, difference
map, timing, memory measurement, and human 0–4 review are retained.
