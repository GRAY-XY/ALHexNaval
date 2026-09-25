import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

interface ArtFile {name?:string;path:string;sha256:string;size:[number,number]}
interface Manifest {source:ArtFile;runtime:ArtFile[]}

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(resolve(root,'data/land-detail-art.json'),'utf8')) as Manifest;
const failures:string[]=[];
const seen=new Set<string>();

for(const file of [manifest.source,...manifest.runtime]){
  let bytes:Buffer;
  try{bytes=readFileSync(resolve(root,file.path));}catch{failures.push(`missing ${file.path}`);continue;}
  const signature=bytes.subarray(0,8).toString('hex'),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),hash=createHash('sha256').update(bytes).digest('hex');
  if(signature!=='89504e470d0a1a0a')failures.push(`not png ${file.path}`);
  if(width!==file.size[0]||height!==file.size[1])failures.push(`size ${file.path}: ${width}x${height}`);
  if(hash!==file.sha256)failures.push(`hash ${file.path}`);
  if(file.name){if(seen.has(file.name))failures.push(`duplicate name ${file.name}`);seen.add(file.name);if(bytes[25]!==6)failures.push(`no rgba alpha ${file.path}`);}
}
if(manifest.runtime.length!==6)failures.push(`runtime count ${manifest.runtime.length}`);
if(failures.length)throw Error(failures.join('\n'));
console.log(JSON.stringify({passed:true,source:manifest.source.path,runtimeSprites:manifest.runtime.length,names:[...seen]}));
