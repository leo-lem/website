---
title: A Second Example
date: 2026-02-02
summary: Another stand-in article, showing a link to another article, a margin note and two sides side by side.
scene:
  - { shape: rhombus, at: [-4, -5], size: 4 }
  - { shape: rhombus, at: [-4, 3], size: 4 }
  - { shape: triangle, at: [-1, 0], size: 6, focus: true }
  - { shape: hexagon, at: [5, 0], size: 4, absent: true }
channels: {}
---

This one builds on [the first example](/first-example/). A link to another article carries its hexagon, and the end of the page connects the two.

## A few blocks

A link to [an article that isn't out yet](/third-example/) stays plain text until its date.

A paragraph with a footnote gets the note beside it.[^1]

[^1]: Like this one.

| Without the articles | With them |
| --- | --- |
| The build reads `site/example/` | The build reads `../articles/` |
| Two stand-in articles | The real ones |

```number
2
example articles in this repository
```
