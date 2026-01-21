name: publish
description: Publish OpenWork DMG releases
---

## Purpose

Publish a new OpenWork release (version bump + DMG + GitHub release) without forgetting any steps.

## Prereqs

- `pnpm`
- Rust toolchain (`cargo`, `rustc`)
- `gh` authenticated (`gh auth status`)
- macOS tools: `hdiutil`, `codesign`, `spctl`

## Workflow

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

Expected output (Apple Silicon example):

- `packages/desktop/src-tauri/target/release/bundle/dmg/OpenWork_<version>_aarch64.dmg`

### 5) Commit + tag

```bash
git commit -am "Release vX.Y.Z"
git tag -a vX.Y.Z -m "OpenWork vX.Y.Z"
git push
git push origin vX.Y.Z
```

### 6) GitHub release

```bash
gh release create vX.Y.Z \
  --title "OpenWork vX.Y.Z" \
  --notes "<summary>"

gh release upload vX.Y.Z "packages/desktop/src-tauri/target/release/bundle/dmg/<DMG_NAME>.dmg" --clobber
```

## Helper

Run the quick check:

```bash
bun .opencode/skill/publish/first-call.ts
```
