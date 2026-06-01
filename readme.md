# livesync-commonlib

Shared TypeScript library for `livesync-bridge` and related Self-hosted LiveSync
tooling.

## Role

This repository carries common code used by the m0sh1.cc LiveSync bridge stack.
It is kept small on purpose: reusable parsing, configuration, and sync helpers
belong here when they are shared by more than one LiveSync-side tool.

## Repository

Forgejo is the source of truth:

- `https://git.m0sh1.cc/m0sh1/livesync-commonlib`

GitHub is maintained as a public push mirror:

- `https://github.com/yaelmoshi/livesync-commonlib`

## Development

This library is usually checked through the consuming LiveSync repository, where
the import map and vendored dependencies are available. Run the consuming
repository's exact Deno checks when changing exported interfaces.

## License

License: MIT
