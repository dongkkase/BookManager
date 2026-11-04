import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanRelativePath, isAllowedReadivePeer, isOnLink, listReadiveInterfaces, transferSizePolicy } from './readive/policy.js';

test('Readive lists distinct private adapter addresses while keeping the original LAN first and restricting sources to its subnet', () => {
    const local = { address: '192.168.2.5', netmask: '255.255.255.0', family: 'IPv4' };
    assert.equal(isOnLink('192.168.2.10', local), true);
    assert.equal(isOnLink('::ffff:192.168.2.10', local), true);
    for (const address of ['192.168.3.10', '192.168.2.0', '192.168.2.255', '8.8.8.8', '127.0.0.1', 'localhost', '192.168.002.10']) {
        assert.equal(isOnLink(address, local), false, address);
    }
    const alternate = { ...local, address: '10.9.0.2' };
    assert.deepEqual(listReadiveInterfaces({
        tap0: [alternate, local],
        en0: [local],
        en1: [{ ...local, address: '8.8.8.8' }, { ...local, address: '192.168.2.20', internal: true }],
        utun1: [{ ...alternate, address: '10.9.0.5', netmask: '255.255.255.255' }],
    }), [
        { name: 'en0', address: local.address, netmask: local.netmask },
        { name: 'tap0', address: alternate.address, netmask: alternate.netmask },
    ]);
    assert.equal(isOnLink('10.9.0.3', alternate), true);
    assert.equal(isOnLink('192.168.2.10', alternate), false);
});

test('Tailscale IPv4 host routes accept tailnet peers only on the identified adapter', () => {
    const assigned = { family: 'IPv4', address: '100.80.0.12', netmask: '255.255.255.255' };
    const v6 = { family: 'IPv6', address: 'fd7a:115c:a1e0::1234' };
    const lan = { family: 'IPv4', address: '192.168.2.5', netmask: '255.255.255.0' };
    for (const [name, addresses] of [['utun8', [v6, assigned]], ['tailscale0', [assigned]], ['Tailscale', [assigned]]]) {
        const [local, tailnet] = listReadiveInterfaces({ [name]: addresses, en0: [lan] });
        assert.equal(local.address, lan.address);
        assert.deepEqual(tailnet, { name, address: assigned.address, netmask: assigned.netmask, kind: 'tailscale' });
        assert.equal(isAllowedReadivePeer('::ffff:100.127.240.10', tailnet), true);
        for (const peer of ['100.63.255.255', '100.128.0.1', '192.168.2.9', '8.8.8.8']) {
            assert.equal(isAllowedReadivePeer(peer, tailnet), false, peer);
        }
        assert.equal(isAllowedReadivePeer('100.127.240.10', local), false);
    }
    assert.deepEqual(listReadiveInterfaces({ en0: [assigned], utun7: [assigned, { ...v6, address: 'fd00::99' }] }), []);
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
