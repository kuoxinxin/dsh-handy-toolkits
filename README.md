# dsh-handy-toolkits

A DeepSeek Harness plugin package. Today it ships one toolkit: **whole-page
zoom**. The desktop window has no page zoom of its own — its `Cmd/Ctrl` `+` / `-`
chords step font sizes — so this plugin scales the document root and remembers
the level.

| Chord (macOS) | Chord (Windows/Linux) | Effect |
|---|---|---|
| `Cmd + Shift + =` | `Ctrl + Shift + =` | Zoom in 10% |
| `Cmd + Shift + -` | `Ctrl + Shift + -` | Zoom out 10% |
| `Cmd + Shift + 0` | `Ctrl + Shift + 0` | Reset to 100% |

- Range 50%–200%, 10% per press; a small readout shows the new level.
- The level persists in `localStorage` (`dsh-handy-toolkits:level`) and is restored on
  the next boot. 100% is never stored.
- Shift is required on purpose: without it the chords belong to the built-in
  font-size commands, and hijacking them would break text sizing.
- Disabling the plugin restores 100% and detaches its listener.

## Install

Quit DeepSeek Harness completely (`Cmd + Q`), then:

```sh
./install.sh            # desktop profile
./install.sh web        # another profile name
```

The script copies the package to `~/.dsh/profiles/<profile>/plugins/dsh-handy-toolkits`
and appends one Loader entry to `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-handy-toolkits
      name: "./plugins/dsh-handy-toolkits/lib/index.js"
```

A patch entry can only edit an existing row, so the entry is added through a
patch's `insert` list rather than as a bare row.

Then reopen DeepSeek Harness. No package manager, dependency, or build step is
involved: the browser bundle at `lib/client.js` is already in the
`window.__ModuleLoader__.load({ id, factory })` form the client module host
serves.

### Manual install

```sh
profile=~/.dsh/profiles/desktop
mkdir -p "$profile/plugins"
cp -R dsh-handy-toolkits "$profile/plugins/dsh-handy-toolkits"
printf '%s\n' '- insert:' '    - id: dsh-handy-toolkits' '      name: "./plugins/dsh-handy-toolkits/lib/index.js"' >> "$profile/cordis.patch.yml"
```

## Uninstall

```sh
./uninstall.sh          # desktop profile
./uninstall.sh web
```

Removes the Loader entry (leaving a `.bak` copy of the patch file) and deletes
the plugin directory. Quit the app first.

The package is also a DSH **bundle** (`dsh.bundle.patch` → `cordis.patch.yml`),
so once it is on npm it installs the normal way — Plugins → Add plugin → the
package name — instead of through `install.sh`.

## Publish

See [PUBLISH.md](PUBLISH.md) for the full checklist: manifest requirements
(`dsh.bundle.patch`, `dsh.client`, `engines.dsh`), `npm publish`, how to test the
install without publishing, and how to get listed in a plugin market (format-1
index for the Discover page, or a PR to `awesome-dsh-plugin`).

## Test

```sh
npm test        # node --test: chords, persistence, clamping, teardown
```

## Verify

1. Reopen the app and look at 设置 → 插件: a row `dsh-handy-toolkits` should be enabled.
2. Press `Cmd/Ctrl + Shift + =` twice: the page (sidebar, transcript, buttons)
   grows, and the readout says `Page zoom 120%`.
3. Quit and reopen: the level is still 120%.

Screenshots from that check (headless Chromium, real GUI, 1440×900): `docs/zoom-100.png`,
`docs/zoom-150.png`, `docs/zoom-200.png`.

## How it works

- `lib/index.js` — host half, an empty `apply()`; it exists so the Loader has an
  enabled row.
- `lib/client.js` — browser half. On mount it restores the stored level, sets
  `document.documentElement.style.zoom`, and installs one capturing `keydown`
  listener. `event.code` (physical key) keeps the chords layout-independent, and
  `preventDefault` + `stopImmediatePropagation` keep them from reaching other
  handlers.
- CSS `zoom` on the root scales layout, text, and hit-testing together in
  Chromium, so pointer coordinates stay correct — unlike a `transform: scale()`.
  Fixed-position surfaces scale with the root instead of detaching from it.

## Troubleshooting

- **Chords do nothing** — the plugin is not enabled, or the bundle is missing:
  check 设置 → 插件 for a load error, then quit and reopen the app.
- **`Page zoom` readout appears but nothing grows** — another plugin sets a
  `zoom` on the root element; only one can own it.
- **Text looks blurry** — CSS `zoom` re-rasterizes text, but fractional levels
  (110%, 130%) can look softer than 100% or 150%. Use the reset chord to return
  to a crisp 100%.
- **The entry is red in 设置 → 插件** — verify the path: the Loader resolves
  `./plugins/...` against the profile directory, so the file must be at
  `~/.dsh/profiles/desktop/plugins/dsh-handy-toolkits/lib/index.js` (a directory or a
  bare `index.js` will not resolve).
- **Content runs off the right edge** — this is real zoom, not a smaller layout
  viewport: at 200% on a narrow window the UI legitimately needs more room. Zoom
  out, widen the window, or hide the sidebar.
