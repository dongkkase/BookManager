import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanRelativePath, isOnLink, listReadiveInterfaces, transferSizePolicy } from './readive/policy.js';

test('Readive LAN policy restricts on-link sources and rejects VPN and public interfaces', () => {
    const local = { address: '192.168.2.5', netmask: '255.255.255.0', family: 'IPv4' };
    assert.equal(isOnLink('192.168.2.10', local), true);
    assert.equal(isOnLink('::ffff:192.168.2.10', local), true);
    for (const address of ['192.168.3.10', '192.168.2.0', '192.168.2.255', '8.8.8.8', '127.0.0.1', 'localhost', '192.168.002.10']) {
        assert.equal(isOnLink(address, local), false, address);
    }
    assert.deepEqual(listReadiveInterfaces({ en0: [local], utun1: [local], en1: [{ ...local, address: '8.8.8.8' }] }), [{ name: 'en0', address: local.address, netmask: local.netmask }]);
});

test('Readive thresholds separate confirmation and hard blocks and count asset bytes', () => {
    assert.deepEqual(transferSizePolicy({ files: 101, folders: 0, bytes: 1 }), { large: true, blocked: false });
    assert.deepEqual(transferSizePolicy({ files: 1, folders: 301, bytes: 1 }), { large: true, blocked: true });
    assert.equal(transferSizePolicy({ files: 1, folders: 0, bytes: 10 * 1024 ** 3 + 1 }).blocked, true);
});

test('Readive relative paths reject traversal and ambiguous separators', () => {
    assert.equal(cleanRelativePath('시리즈/1권/book.txt'), '시리즈/1권/book.txt');
    for (const value of ['../secret', '/secret', 'a/../b', 'a//b', 'part:a/book.txt', 'C:/secret', 'a\\b', 'a/\0b']) assert.throws(() => cleanRelativePath(value));
});
