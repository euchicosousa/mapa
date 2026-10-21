import { expect, it } from 'vitest';
import fixture from '../../tests/fixtures/mapa-backup-v1.json';
import { BACKUP_MAX_BYTES, backupFilename, createPortableBackup, portableBackupSchema } from './backup';
const id=(i:number)=>`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`;
const node=(i:number,parent:number|null,text='Ideia')=>({id:id(i),parentId:parent===null?null:id(parent),text,sortOrder:0});
const tree=[node(1,null,'Raiz 🌍'),node(2,1,'Ação\n日本語'),node(3,2,'<script>alert("texto puro")</script>')];
const now=new Date('2026-10-20T12:00:00.000Z');
it('validates the documented v1 fixture and preserves Unicode, plain text, order and parent relations in JSON',()=>{
  expect(portableBackupSchema.safeParse(fixture).success).toBe(true);
  const file=createPortableBackup({title:'Café ☕',nodes:tree},false,now);
  expect(JSON.parse(file.json)).toEqual({format:'mapa-mental',version:1,exportedAt:now.toISOString(),hasPendingChanges:false,map:{title:'Café ☕'},nodes:tree});
});
it('copies only portable fields and freezes a snapshot before asynchronous work, without leaking scope, Auth or authors',()=>{
  const document={title:'Meu mapa',workspaceId:id(8),ownerEmail:'private@example.com',token:'secret-token',people:{private:'private@example.com'},nodes:tree.map(n=>({...n,mapId:id(9),createdBy:id(7),updatedBy:id(8),source:'ai',aiGenerationId:id(6)}))};
  const file=createPortableBackup(document,true,now);document.nodes[0].text='Modificado depois';document.title='Novo título';
  expect(file.backup.nodes[0].text).toBe('Raiz 🌍');expect(file.backup.map.title).toBe('Meu mapa');expect(file.backup.hasPendingChanges).toBe(true);
  for(const forbidden of ['workspaceId','ownerEmail','private@example.com','secret-token','createdBy','updatedBy','source','aiGenerationId',id(9)])expect(file.json).not.toContain(forbidden);
});
it.each([
  ['empty',[]],['two roots',[node(1,null),node(2,null)]],['duplicate IDs',[node(1,null),node(1,1)]],
  ['foreign parent',[node(1,null),node(2,99)]],['self cycle',[node(1,null),node(2,2)]],
  ['disconnected cycle',[node(1,null),node(2,3),node(3,2)]],
])('rejects a malformed tree: %s',(_name,nodes)=>{expect(()=>createPortableBackup({title:'Mapa',nodes},false,now)).toThrow();});
it('accepts depth 30 and 500 nodes, rejects depth 31 and 501 nodes without truncation',()=>{
  const deep=Array.from({length:31},(_,i)=>node(i+1,i===0?null:i));
  expect(createPortableBackup({title:'Profundo',nodes:deep},false,now).backup.nodes).toHaveLength(31);
  expect(()=>createPortableBackup({title:'Profundo',nodes:[...deep,node(32,31)]},false,now)).toThrow(/30 níveis/);
  const large=Array.from({length:500},(_,i)=>node(i+1,i===0?null:1,'\u0001'.repeat(500)));
  const file=createPortableBackup({title:'Grande',nodes:large},true,now);expect(file.backup.nodes).toHaveLength(500);expect(new TextEncoder().encode(file.json).length).toBeLessThanOrEqual(BACKUP_MAX_BYTES);
  expect(()=>createPortableBackup({title:'Grande',nodes:[...large,node(501,1)]},false,now)).toThrow();
});
it('validates nonblank text/title, integers and Unicode code point limits without cutting content',()=>{
  for(const title of ['', ' ', 'x'.repeat(121)])expect(()=>createPortableBackup({title,nodes:tree},false,now)).toThrow();
  for(const text of ['', '\n ', 'x'.repeat(501)])expect(()=>createPortableBackup({title:'Mapa',nodes:[node(1,null,text)]},false,now)).toThrow();
  for(const sortOrder of [-1,0.5,2147483648])expect(()=>createPortableBackup({title:'Mapa',nodes:[{...node(1,null),sortOrder}]},false,now)).toThrow();
  expect(createPortableBackup({title:'🌍'.repeat(120),nodes:[node(1,null,'🌍'.repeat(500))]},false,now).backup.nodes[0].text).toBe('🌍'.repeat(500));
});
it('rejects unknown fields, unsupported versions, invalid dates/IDs and missing pending marker at the format boundary',()=>{
  for(const data of [{...fixture,version:2},{...fixture,exportedAt:'today'},{...fixture,token:'secret'},{...fixture,map:{...fixture.map,workspaceId:id(99)}},{...fixture,nodes:[{...tree[0],id:'not-a-uuid'}]},{...fixture,hasPendingChanges:undefined}])expect(portableBackupSchema.safeParse(data).success).toBe(false);
});
it('sanitizes native filenames, limits title length and keeps extension and UTC date',()=>{
  const filename=backupFilename('../CON\\?*:\u0000 日本語 Café ☕',now.toISOString());expect(filename).toBe('mapa-CON-日本語-Café-2026-10-20.json');expect(filename).not.toMatch(/[\\/:*?"<>|]/);expect(filename).not.toContain("\u0000");
  expect(backupFilename('...///',now.toISOString())).toBe('mapa-sem-titulo-2026-10-20.json');expect(backupFilename('W'.repeat(120),now.toISOString())).toBe(`mapa-${'W'.repeat(64)}-2026-10-20.json`);
});

it('checks file byte size before any read and rejects empty, malformed or non-UTF-8 input',async()=>{
  const {readPortableBackup}=await import('./backup');let reads=0;
  const oversized={size:BACKUP_MAX_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}};
  await expect(readPortableBackup(oversized)).rejects.toThrow(/2 MB/);expect(reads).toBe(0);
  await expect(readPortableBackup({...oversized,size:0})).rejects.toThrow(/vazio/);expect(reads).toBe(0);
  for(const bytes of [new Uint8Array([0xff]),new TextEncoder().encode('{broken')])await expect(readPortableBackup({size:bytes.length,arrayBuffer:async()=>bytes.buffer})).rejects.toThrow(/JSON UTF-8/);
});
it('reads the exported fixture and rejects format/version, unknown authorship and malformed structure before upload',async()=>{
  const {readPortableBackup}=await import('./backup');
  const file=(value:unknown)=>{const bytes=new TextEncoder().encode(JSON.stringify(value));return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};};
  expect(await readPortableBackup(file(fixture))).toEqual(fixture);
  await expect(readPortableBackup(file({...fixture,format:'mapa-emergency-draft'}))).rejects.toThrow(/emergência/);
  await expect(readPortableBackup(file({...fixture,version:2}))).rejects.toThrow(/Versão/);
  await expect(readPortableBackup(file({...fixture,map:{...fixture.map,ownerId:id(99)}}))).rejects.toThrow(/inválido/);
  await expect(readPortableBackup(file({...fixture,nodes:[node(1,null),node(2,3),node(3,2)]}))).rejects.toThrow(/ciclo/);
});
