# Third-Party Notices

## Supertonic inference reference implementation

The local Supertonic TTS inference code is adapted from the Supertonic Node.js reference implementation.

Copyright (c) 2025 Supertone Inc.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## QRCode for JavaScript / qrcode-terminal encoder

LAN pairing QR codes use the QRCode encoder from qrcode-terminal 0.11.0.
The original QRCode implementation is Copyright (c) 2009 Kazuhiko Arase,
licensed under MIT. The qrcode-terminal Node adaptation is distributed under
Apache License 2.0. The source is vendored under electron/readive/vendor/qrcode;
only .cjs filenames/imports and four-space indentation were adapted.

- Source: https://github.com/gtanner/qrcode-terminal/tree/v0.11.0/vendor/QRCode
- Original MIT notice and full license: electron/readive/vendor/qrcode/LICENSE.MIT
- Original qrcode-terminal Apache 2.0 license: electron/readive/vendor/qrcode/LICENSE.qrcode-terminal

Both full license texts are included with the bundled encoder.

## CodeMirror 6 and supporting packages

The text cleaner uses CodeMirror for virtualized text editing. The EPUB editor
uses its CSS and HTML language support for syntax highlighting.

- @codemirror/state, @codemirror/view, @codemirror/commands, @codemirror/language,
  @codemirror/lang-css, @codemirror/lang-html, @codemirror/lang-javascript,
  @codemirror/autocomplete, @lezer/css, @lezer/html, @lezer/javascript:
  Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- @lezer/common, @lezer/highlight, @lezer/lr, style-mod:
  Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- @marijn/find-cluster-break:
  Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin>
- crelt:
  Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>
- w3c-keyname:
  Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Tiptap, ProseMirror and EPUB editor dependencies

The EPUB editor uses the MIT-licensed Tiptap 3.31.3 editor, its extensions,
ProseMirror and the following supporting packages.

- Tiptap (@tiptap/*): Copyright (c) 2025, Tiptap GmbH
- ProseMirror (commands, dropcursor, gapcursor, history, inputrules, keymap,
  model, schema-list, state, transform, view): Copyright (C) 2015-2017 by
  Marijn Haverbeke <marijn@haverbeke.berlin> and others
- prosemirror-changeset: Copyright (C) 2017 by Marijn Haverbeke and others
- prosemirror-tables: Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
- orderedmap: Copyright (C) 2016 by Marijn Haverbeke and others
- rope-sequence: Copyright (C) 2016 by Marijn Haverbeke
- Floating UI (@floating-ui/*): Copyright (c) 2021-present Floating UI contributors
- fast-equals: Copyright (c) 2025 Tony Quetano
- linkifyjs: Copyright (c) 2024 Nick Frasser
- use-sync-external-store: Copyright (c) Meta Platforms, Inc. and affiliates.
- uuid: Copyright (c) 2010-2020 Robert Kieffer and other contributors
- csstype: Copyright (c) 2017-2018 Fredrik Nicol
- @types/react, @types/react-dom, @types/use-sync-external-store:
  Copyright (c) Microsoft Corporation.

Sources: https://github.com/ueberdosis/tiptap,
https://github.com/ProseMirror, https://github.com/uuidjs/uuid.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## CSS Tree

The EPUB editor uses CSS Tree 3.2.1 to parse and validate author stylesheets.

MIT License

Copyright (C) 2016-2026 by Roman Dvornov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Korean IME symbol data (libhangul)

The EPUB character picker includes the consonant symbol groups adapted from
libhangul data/hanja/mssymbol.txt, retrieved on 2026-09-22.
Source: https://github.com/libhangul/libhangul/blob/main/data/hanja/mssymbol.txt

BSD 3-Clause License

Copyright (c) 2005-2014 Choe Hwanjin
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the author nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## Unicode Emoji and CLDR annotation data

The EPUB emoji picker includes Unicode Emoji 17.0 fully-qualified sequences
and Korean names and keywords from CLDR 48. Data is bundled for offline use.

Sources:

- https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt
- https://github.com/unicode-org/cldr/blob/release-48/common/annotations/ko.xml
- https://github.com/unicode-org/cldr/blob/release-48/common/annotationsDerived/ko.xml

UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
