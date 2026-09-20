import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { exchangeRatings } from './readive/ratings.js';
import { ReadiveService } from './readive/service.js';

const hash = 'a'.repeat(64);
async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'readive-rating-')));
    const filePath = path.join(root,'book.txt');await fs.writeFile(filePath,'original book');
    const libraryDb = new LibraryDB({dbPath:path.join(root,'library.db')});
    await libraryDb.setFileRating(filePath,4);
    t.after(async()=>{await libraryDb.close();await fs.rm(root,{recursive:true,force:true});});
    const stat=await fs.stat(filePath);
    const identity=Object.fromEntries(['dev','ino','size','mtimeMs','ctimeMs','birthtimeMs'].map(key=>[key,stat[key]]));
    const item={itemId:'item',contentHash:hash,sourcePath:filePath,identity,deviceIds:['phone-123']};
    const state={items:{[hash]:item}};const device={id:'phone-123'};
    const upload=(rating=8,baseRating=4)=>({itemId:'item',contentHash:hash,rating,baseRating,mutationId:randomUUID()});
    const exchange=records=>exchangeRatings(state,device,{itemIds:['item'],records},libraryDb);
    return {root,filePath,libraryDb,state,device,item,upload,exchange,stat};
}
test('rating exchange writes only the DB override and preserves original bytes',async t=>{
    const f=await fixture(t);const upload=f.upload();const result=await f.exchange([upload]);
    assert.equal(result.records[0].rating,8);assert.equal(result.records[0].acknowledgedMutationId,upload.mutationId);
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating_override,'8');
    assert.equal(await fs.readFile(f.filePath,'utf8'),'original book');
    assert.equal((await fs.stat(f.filePath)).mtimeMs,f.stat.mtimeMs);
});
test('response-loss retry never overwrites a newer desktop rating',async t=>{
    const f=await fixture(t);const upload=f.upload();await f.exchange([upload]);
    await f.libraryDb.setFileRating(f.filePath,6);
    const retry=await f.exchange([upload]);assert.equal(retry.records[0].rating,6);assert.equal(retry.records[0].acknowledgedMutationId,upload.mutationId);
    assert.equal(retry.changed.length,0);
});
test('conflicting desktop edits require a fresh base rating',async t=>{
    const f=await fixture(t);await f.libraryDb.setFileRating(f.filePath,5);
    const result=await f.exchange([f.upload()]);assert.equal(result.records[0].conflict,true);assert.equal(result.records[0].rating,5);
    assert.equal((await f.exchange([f.upload(8,5)])).records[0].conflict,false);
});
test('CAS under the library DB lock protects a change during exchange',async t=>{
    const f=await fixture(t);const save=f.libraryDb.setFileRating.bind(f.libraryDb);
    f.libraryDb.setFileRating=async(...args)=>{await save(f.filePath,9);return save(...args);};
    const result=await f.exchange([f.upload()]);assert.equal(result.records[0].conflict,true);assert.equal(result.records[0].rating,9);
});
test('unknown device and replaced source cannot read or modify an old binding',async t=>{
    const f=await fixture(t);
    assert.deepEqual((await exchangeRatings(f.state,{id:'other'},{itemIds:['item'],records:[f.upload()]},f.libraryDb)).records,[]);
    await fs.writeFile(f.filePath,'different book');assert.deepEqual((await f.exchange([f.upload()])).records,[]);
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating,'4');
});
test('rating protocol rejects invalid batches, mismatched hashes, values and mutation IDs',async t=>{
    const f=await fixture(t);
    for(const patch of [{rating:0},{rating:11},{rating:4.5},{rating:null},{baseRating:'4'},{mutationId:'x'},{contentHash:'b'.repeat(64)},{path:f.filePath}])await assert.rejects(f.exchange([{...f.upload(),...patch}]));
    await assert.rejects(exchangeRatings(f.state,f.device,{itemIds:Array(501).fill('item'),records:[]},f.libraryDb));
    await assert.rejects(exchangeRatings(f.state,f.device,{itemIds:['item'],records:[f.upload()]},null),/rating_unavailable/);
});
test('cancelled rating exchange never mutates the database',async t=>{
    const f=await fixture(t);
    await assert.rejects(exchangeRatings(f.state,f.device,{itemIds:['item'],records:[f.upload()]},f.libraryDb,()=>{throw Error('cancelled');}),/cancelled/);
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating,'4');
});
test('authenticated service routes ratings, preserves the store on pull and notifies desktop UI',async t=>{
    const f=await fixture(t);const changes=[];
    const local={name:'en0',address:'192.168.5.10',netmask:'255.255.255.0'};
    const remote={remoteAddress:'192.168.5.20',localAddress:local.address};
    const service=new ReadiveService({directory:path.join(f.root,'state'),interfaces:()=>[local],getLibraryDb:()=>f.libraryDb,onRatingChanged:items=>changes.push(...items)});
    service.localInterface=local;service.port=19421;service.server={close:callback=>callback()};service.certificateSha256='a'.repeat(64);
    const ticket=JSON.parse((await service.pairing()).ticket);
    const {json:{token}}=await service.dispatch({...remote,method:'POST',pathname:'/readive/v1/pair',body:{secret:ticket.secret,deviceId:'phone-123',deviceName:'Phone'}});
    await service.store.transact(state=>{state.items[hash]=f.item;});
    const request={...remote,method:'POST',pathname:'/readive/v1/ratings',body:{itemIds:['item'],records:[f.upload()]}};
    await assert.rejects(service.dispatch({...request,token:'invalid'}),/unauthorized/);
    assert.equal((await service.dispatch({...request,token})).json.records[0].rating,8);assert.equal(changes.length,1);
    const before=await fs.stat(service.store.filePath);
    await service.dispatch({...request,token,body:{itemIds:['item'],records:[]}});
    assert.equal((await fs.stat(service.store.filePath)).mtimeMs,before.mtimeMs);
    const old=await fs.stat(f.filePath);await fs.writeFile(f.filePath,'book after trusted desktop rating edit');
    await service.recordRatingChange(f.filePath,old);await f.libraryDb.setFileRating(f.filePath,10);
    assert.equal((await service.dispatch({...request,token,body:{itemIds:['item'],records:[]}})).json.records[0].rating,10);
    assert.deepEqual(service.store.state.items[hash].identity,f.item.identity,'original transfer identity stays frozen');
    await service.revoke({deviceId:'phone-123'});await assert.rejects(service.dispatch({...request,token}),/unauthorized/);
});
