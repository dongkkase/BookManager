import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'components', 'FaIcon.jsx'),
    'utf8',
);

test('화면에서 사용하는 Font Awesome 의미 아이콘을 모두 등록한다', () => {
    const required = [
        'angleDown', 'angleUp', 'anglesDown', 'anglesUp', 'archive', 'bars',
        'arrowRotateLeft', 'book', 'bookmark', 'bookOpen', 'bug', 'check', 'checkSquare',
        'caret-down', 'chevronLeft', 'chevronRight', 'circle', 'circleCheck', 'clock', 'cloudArrowDown',
        'copy', 'cube', 'discord', 'ellipsisVertical', 'eye', 'eyeSlash', 'file', 'file-circle-plus', 'fileSignature', 'file-zipper', 'floppy',
        'folder', 'folder-open', 'folder-plus', 'folderMinus', 'folderOpen', 'gear', 'gift', 'language',
        'layer-group', 'list', 'microsoft', 'minusCircle', 'pin', 'plus', 'powerOff', 'rocket', 'search',
        'square', 'star', 'stopCircle', 'tableCells', 'thumbtack', 'towerBroadcast', 'trash', 'wand',
        'xmark',
    ];
    for (const name of required) {
        assert.match(source, new RegExp(`['"]?${name.replace('-', '\\-')}['"]?\\s*:`), name);
    }
});
