# release

Create a human-friendly **unsigned macOS DMG** release for OpenWork (or similar Tauri apps), and publish it on GitHub.

This skill is intentionally lightweight: it’s mostly a checklist + a couple of sanity scripts.

## What this skill is for

- You have a Tauri app.
- You want to publish a **DMG** on GitHub Releases.
- You are **not** code signing / notarizing yet (so macOS will warn users).

## Prereqs

- `pnpm`
- Rust toolchain (`cargo`, `rustc`)
- `gh` authenticated (`gh auth status`)
- macOS tools: `codesign`, `spctl`, `hdiutil`

## Release checklist (recommended)

### 1) Clean working tree

```bash
git status
```

### 2) Bump version everywhere

- `packages/desktop/package.json` (`version`)
- `packages/desktop/src-tauri/tauri.conf.json` (`version`)
- `packages/desktop/src-tauri/Cargo.toml` (`version`)

### 3) Validate builds

```bash
pnpm typecheck
pnpm build:web
cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml
```

### 4) Build DMG

```bash
pnpm tauri build --bundles dmg
```

This should produce something like:

- `packages/desktop/src-tauri/target/release/bundle/dmg/OpenWork_<version>_aarch64.dmg`

### 5) Verify “unsigned” state

Unsigned here means: **not Developer ID signed / not notarized**.

Quick checks:

```bash
# mount the dmg read-only
hdiutil attach -nobrowse -readonly "packages/desktop/src-tauri/target/release/bundle/dmg/<DMG_NAME>.dmg"

# verify signature details (expect ad-hoc or not notarized)
codesign -dv --verbose=4 "/Volumes/<VOLUME>/<APP>.app"

# gatekeeper assessment (expect rejected)
spctl -a -vv "/Volumes/<VOLUME>/<APP>.app" || true

# unmount
hdiutil detach "/Volumes/<VOLUME>"
```

### 6) Tag + push

```bash
git commit -am "Prepare vX.Y.Z release"
git tag -a vX.Y.Z -m "OpenWork vX.Y.Z"
git push
git push origin vX.Y.Z
```

### 7) Create / update GitHub Release

```bash
gh release create vX.Y.Z \
  --title "OpenWork vX.Y.Z" \
  --notes "<human summary>"

gh release upload vX.Y.Z "packages/desktop/src-tauri/target/release/bundle/dmg/<DMG_NAME>.dmg" --clobber
```

## Local helper scripts

- `bun .opencode/skill/release/first-call.ts` checks prerequisites and prints the current version.

## Notes

- If you later add signing/notarization, this skill should be updated to include that flow.
