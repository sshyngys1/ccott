# Contributing to CCOTT

CCOTT is an early-stage Windows desktop application. Focused bug reports, reproducible examples, and small improvements are welcome.

## Getting started

Follow the requirements and setup instructions in [README.md](README.md). Use `npm run tauri dev` to test native behavior. Use `npm run dev` for the browser preview with mock data.

## Making changes

1. Create a branch for a focused change.
2. Follow the existing module structure and use the design tokens in `src/design/tokens.css`.
3. Route frontend calls to the native backend through `src/ipc/`. Keep the contracts in `src/shared/types.ts` and `docs/contracts.md` consistent with any IPC changes.
4. Add meaningful tests for changed logic and verify the affected behavior.
5. Describe the problem, the resulting behavior, and the checks you ran in your pull request. Include screenshots for visual changes.

The native backend targets Windows. Verify media, audio, clipboard, window focus, monitor selection, and startup behavior in the desktop application when those areas change; the browser mock cannot validate them.

## Validation

```powershell
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Run the checks relevant to the change and report any limitations. Keep generated output, local databases, credentials, and machine-specific configuration out of commits.

## Reporting bugs

Include your Windows version, steps to reproduce, expected behavior, actual behavior, and relevant logs or screenshots. Remove private clipboard content and other personal information from reports.

## License

Contributions are provided under the project's [MIT License](LICENSE).
