# nanoAstra project page

Static page for *A Glimpse of Training VLMs as Foundation Models for Robotic Manipulation*.
No build step: `index.html` + `static/`.

## Preview locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy to GitHub Pages

1. Push this folder's contents to the root of a repo (e.g. `nanoastra.github.io`, or any repo).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.

## Before going public (search `TODO` in index.html)

- Paper / Code buttons are "coming soon" placeholders; replace them with real links.
- `og:image` needs an absolute URL for link previews.
- Update the BibTeX once the arXiv entry exists.

## Updating figures

Images in `static/images/` are rendered from `RoboticFoundation-CVPRv2/figures/*.pdf`
(about 2600 px wide, white margins cropped). Re-export them when a paper figure changes.
