import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

interface LandmarkAsset {kind:string;path:string;sha256:string;size:[number,number]}
interface Manifest {version:number;generator:string;promptSet:string;processing:string;sources:LandmarkAsset[];assets:LandmarkAsset[]}

const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'data/campaign-landmark-art.json'),'utf8')) as Manifest;
const expectedKinds=['airfield','seaplane-base','naval-yard','field-hq'];
assert.equal(manifest.version,6);
assert.equal(manifest.generator,'OpenAI built-in image generation');
assert.equal(manifest.processing,'tools/prepare_landmark_art.py removes the magenta chroma key and decontaminates edge pixels');
assert.equal(manifest.sources.length,expectedKinds.length);
assert.deepEqual(manifest.sources.map(asset=>asset.kind),expectedKinds);
assert.equal(manifest.assets.length,expectedKinds.length);
assert.deepEqual(manifest.assets.map(asset=>asset.kind),expectedKinds);
assert(readFileSync(resolve(root,manifest.promptSet),'utf8').includes('## Field headquarters'));

for(const [assets,hasAlpha] of [[manifest.sources,false],[manifest.assets,true]] as const){
  for(const asset of assets){
    const bytes=readFileSync(resolve(root,asset.path));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${asset.kind} is a PNG`);
    assert.equal(bytes.readUInt32BE(16),asset.size[0],`${asset.kind} width`);
    assert.equal(bytes.readUInt32BE(20),asset.size[1],`${asset.kind} height`);
    if(hasAlpha)assert.equal(bytes[25],6,`${asset.kind} includes RGBA transparency`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,`${asset.kind} SHA-256`);
  }
}

console.log(JSON.stringify({passed:true,landmarks:manifest.assets.map(({kind,path})=>({kind,path}))}));
