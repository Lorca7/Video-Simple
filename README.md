# Video Simple

A simple, stand-alone video editor for macOS whose only job is to get you from raw clips to a
video that is ready to upload to YouTube.

- **Drag & drop** video, audio and images straight from Finder
- **Edit**: trim, split, reorder, duplicate, delete, undo/redo
- **Audio**: per-clip volume, mute, fade in/out, two extra tracks for music and voice-over (with waveforms)
- **Text & motion graphics**: one-click styles (title, subtitle, lower third, caption, …), drag text
  directly on the preview, animate in/out (fade, slide, pop, zoom, typewriter)
- **Export for YouTube**: one button → an `.mp4` on your Desktop

## Install (macOS 12 or later, including Sonoma 14.6)

1. Download the DMG for your Mac from the latest **Build macOS app** run under the repo's *Actions* tab
   (`arm64` = Apple Silicon M1/M2/M3/M4, `x64` = Intel).
2. Open the DMG and drag **Video Simple** to Applications.
3. The app is not signed with an Apple Developer ID, so the first time, **right-click the app → Open → Open**.
   (If macOS still refuses, run `xattr -cr "/Applications/Video Simple.app"` in Terminal once.)

Everything is bundled — there is nothing else to install.

## Using it

| Do this | How |
| --- | --- |
| Import | Drag files into the window, or **＋ Import** (⌘I) |
| Add to timeline | Drag from the Media panel, or double-click |
| Trim | Drag the left/right edge of a clip |
| Reorder / move | Drag the clip |
| Split | Put the playhead where you want the cut, press **S** |
| Delete / Duplicate | **Delete** / **⌘D** |
| Add text | **T**, or pick a style in the **Text** tab; drag it on the preview to position |
| Play / pause | **Space** (← → step one frame, ⇧← → one second) |
| Zoom timeline | Slider, **+ / −**, or ⌘-scroll; **Fit** shows everything |
| Save project | ⌘S (`.vsproj` – stores your edit, not copies of the media) |
| Export | **Export for YouTube** (⌘E) |

The video track is "magnetic": clips always sit back-to-back, so there are never accidental gaps.
Text and audio clips can be placed freely and snap to the playhead and to other clips (hold ⌥ to disable).

## Export format

Follows YouTube's recommended upload settings:

| | |
| --- | --- |
| Container | MP4, moov atom at the front (fast start) |
| Video | H.264 High profile, progressive, 4:2:0, BT.709, closed GOP of ½ the frame rate, 2 B-frames |
| Aspect ratio | 16:9 — 720p, **1080p (default)**, 1440p or 4K; other shapes are fitted with black bars |
| Frame rate | 24, **30** or 60 fps |
| Quality | Constant quality (CRF 17), capped at 1.5× YouTube's recommended bitrate |
| Audio | AAC-LC, stereo, 48 kHz, 384 kbps |

## Development

```sh
npm install
npm start        # run the app
npm test         # export pipeline smoke test
npm run dist     # build the DMG (on a Mac) into dist/
```

Built with Electron; encoding is done by a bundled ffmpeg ([ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), GPL build).

Known limits: HDR footage is not tone-mapped; clip-to-clip transitions are fades through black
(no cross-dissolves); preview volume tops out at 100% (boosts are applied on export).
