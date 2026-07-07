# bookmark-stash (POC)

A tiny single-collection crouton app — a personal bookmark keeper. Epic #1209.

> **Status: schema design only (WS1, #1212).** This directory currently holds *only* the
> data-model definition (`schemas/bookmarks.json` + `crouton.config.js`). The full Nuxt
> app scaffold and `crouton config` generation happen in WS2 (#1213), gated on schema
> sign-off of #1212.

## Collection: `bookmarks`

| Field   | Type            | Required | Notes                                             |
|---------|-----------------|----------|---------------------------------------------------|
| title   | string          | yes      | max 200                                           |
| url     | string          | yes      | max 2048 — the bookmarked link                    |
| tags    | string          | no       | comma-separated (no relation table for this POC)  |
| notes   | text (long)     | no       |                                                   |

`teamId` / `owner` / `createdAt` are auto-injected by the crouton generator (team scoping),
so they are not declared in the fieldsFile.
