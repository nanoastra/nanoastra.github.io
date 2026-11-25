# nanoAstra project page

Static page for *A Glimpse of Training VLMs as Foundation Models for Robotic Manipulation*.
No build step: `index.html` + `static/`.

## Preview locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy to GitHub Pages

1. Push this folder's contents to the root of a repo (e.g. `nanoastra.github.io`, or any repo).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.

## Updating figures

Images in `static/images/` are rendered from the paper's PDF figures
(about 2600 px wide, white margins cropped). Re-export them when a paper figure changes.

## Streaming figures

The figure under *Streaming execution* is drawn in the browser by `static/streaming.js` (styles: the
"streaming execution" section of `static/style.css`). Only the simulator camera is video.

- `figure.sf`: one `.vthumb` button per episode (`data-ep`); the first one plays first. There are no
  captions: the panels label what happens (snapshot sent, what the model is reading or writing, cards marked for the
  next reply, prefilled steps).

`static/streaming/` per episode: `<name>.mp4` (camera only, 960×720, frame n = n/30 s of simulated time), the poster
`<name>.jpg`, the picker thumbnail `<name>-thumb.jpg`, the images the model received at each turn
(`<name>/<turn>-*.jpg`), and `<name>.json`: per turn, when the request was sent and its text, when the progress line
and each step were written (H20 latency model), every step's raw JSON and when it ran, and its outcome.

The episodes come from the streaming evaluation on RoboTwin 2.0. Each was executed again in the simulator with the same
seed and code, feeding back the model's recorded replies with their recorded token timing, and filmed every 1/30 s of
simulated time. A replay is used only if it matches the evaluation at every turn (same replies and outcomes, robot and
object positions within 2 cm, success time within 0.3 s). The comparison uses the evaluation traces directly.
