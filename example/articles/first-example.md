---
title: A First Example
date: 2026-01-05
summary: A stand-in article, so the site builds and runs from this repository alone.
scene:
  - { shape: triangle, at: [0, -10], size: 4 }
  - { shape: hexagon, at: [0, 3], size: 6, focus: true }
channels: {}
---

This is example content. The real articles live in a private repository, and the build falls back to the files in `site/example/` when they aren't there.

## What an article is

One Markdown file in `articles/`, with its frontmatter on top. The file name is the address: this one is served at `/first-example/`.

> One line in a blockquote is the key sentence, set large.

## What comes next

A second example builds on this one, and its page links back here.
