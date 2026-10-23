# VMNTe flow

The interface uses the VMNTe v3 identity from the local Brand Standards guide
(`http://127.0.0.1:8490/marca/vmnte/`): paper `#f1f1f1`, ink `#000000`, and
self-hosted Rethink Sans at weight 400. Size and spacing establish hierarchy.
The user's requested glass material and blue/orange liquid sphere are intentional
adaptations of that identity for Flow.

## Assets

- `brand/Group 15511.svg` → `public/brand/flow-mark.svg`, used in navigation and onboarding.
- `brand/VMNTe CrazyApp Logo White.svg` → `public/brand/flow-app.svg`, the browser icon.
- `brand/VMNTe CrazyApp Logo White.png` → desktop icons, rendered with `bun run tauri icon`.
- `brand/Ellipse 707.png` → `public/brand/flow-texture.png`, the orb's texture.
- Rethink Sans was copied from the user's VMNTe design system into `public/fonts`.
- `python3 scripts/generate-flow-tray.py` regenerates the tray variants from the
  supplied SVG silhouette, preserving distinct idle, recording, working and warning states.

No assets or fonts depend on the brand server at runtime.

## Surfaces and motion

The app intentionally presents the light identity regardless of the system theme.
The old theme preference remains stored for compatibility, but the appearance
selector is removed. macOS uses native UnderWindowBackground vibrancy; Windows
uses acrylic. Translucent CSS layers provide the interface surfaces, with an
opaque fallback for reduced transparency.

`GlassOrb` is shared by the home screen and recording overlay. Its 850 ms assembly
combines merging droplets, a morphing silhouette, moving material and specular
reflections. Audio energy comes only from microphone events, after
`recording-ready`. Working states move the reflection and texture; stopping fades
out within the native window's existing 300 ms grace period. Reduced motion
turns off the material animations. Cancelling and live transcript scroll-back
remain available.

Native sizes match the CSS footprint: 256 × 156 points for the compact orb,
400 × 276 for live text. The orb itself is 86 × 86. Both top and bottom placement
are supported.

## Sound

`python3 scripts/generate-flow-sounds.py` regenerates sixteen original mono PCM WAVs
at 48 kHz, with smoothed attacks/tails and a peak of −12.4 dBFS. No external samples.

| Display name      | Persisted ID / filenames | Start  | Stop   |
| ----------------- | ------------------------ | ------ | ------ |
| Crystal / Cristal | `marimba`                | 190 ms | 280 ms |
| Felt / Fieltro    | `pop`                    | 160 ms | 240 ms |
| Droplet / Gota    | `droplet`                | 170 ms | 230 ms |
| Silk / Seda       | `silk`                   | 190 ms | 290 ms |
| Wood / Madera     | `wood`                   | 140 ms | 200 ms |
| Orbit / Órbita    | `orbit`                  | 180 ms | 270 ms |
| Air / Aire        | `air`                    | 190 ms | 280 ms |
| Pulse / Pulso     | `pulse`                  | 130 ms | 190 ms |

The legacy IDs avoid resetting existing preferences. Custom sounds retain their
existing behavior. The theme selector is now available in General → Sound.
Start sounds stay short because the capture path waits for them to finish.

## Verification

`tests/flow-design.spec.ts` runs the real UI and Zustand stores against a simulated
Tauri IPC boundary. It checks navigation, sound preview commands, permission
onboarding, compact layout, capture readiness, cancellation, live text, exit
transitions and reduced motion. This is UI integration coverage, not a live
microphone or operating-system permission test.

The UI has been reviewed in Chromium and WebKit. The sound integration test exercises
selection and preview for all eight themes; the Rust audio test decodes every bundled
WAV and checks saved theme values, sample rate, duration, peak and silent endpoints.
Native build verification uses:

```sh
bun run lint
bunx playwright test
bunx playwright test tests/flow-design.spec.ts --config playwright.webkit.config.ts
cd src-tauri && cargo fmt -- --check
CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo clippy --lib
CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --lib audio_feedback::tests
# From the repository root:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build --bundles app
```

The macOS bundle is an ad-hoc signed release build. Native desktop transparency,
real microphone capture, and playback through the selected physical output still
need an interactive device check. This machine's Command Line Tools configuration
builds Apple Intelligence with the repository's existing stubs rather than the
full-Xcode FoundationModels integration.

## App identity

The display name is **VMNTe flow**. The existing `com.vmnte.xulflow` bundle ID,
internal executable and storage paths are retained so settings, history and models
stay in place. GitHub remains at `juliogv00/Xulflow`.

macOS Accessibility grants are tied to the executable signature. Ad-hoc builds
change that signature on each rebuild. If macOS retains an enabled entry for an
older build but the app still asks for access, remove that entry from System
Settings → Privacy & Security → Accessibility and add the newly installed
`/Applications/VMNTe flow.app`. A distribution signing identity is needed for
stable identity across releases; none is configured on this machine.
