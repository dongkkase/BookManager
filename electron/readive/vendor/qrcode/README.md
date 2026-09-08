# QR encoder source

This is the QRCode encoder vendored from qrcode-terminal 0.11.0, already present in the sibling Readive development dependency tree.

- Upstream: https://github.com/gtanner/qrcode-terminal/tree/v0.11.0/vendor/QRCode
- Original encoder: Copyright (c) 2009 Kazuhiko Arase, MIT license.
- qrcode-terminal packaging and Node adaptations: Apache License 2.0, preserved in LICENSE.qrcode-terminal.
- Local changes: CommonJS filenames/imports use .cjs for this ESM application; indentation uses four spaces. Encoder behavior is unchanged.
- Only the encoder is bundled. No runtime package dependency, remote QR service, or network request is introduced.
