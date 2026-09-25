import {ART_DIRECTIONS} from './directional-art.ts';

export interface WatercolorTextures {
  ocean:HTMLCanvasElement;
  land:HTMLCanvasElement;
  mountains:HTMLCanvasElement[];
  harbors:HTMLCanvasElement[];
  coasts:HTMLCanvasElement[];
  landDetails:HTMLCanvasElement[];
}

let textures:WatercolorTextures|undefined;

async function loadTile(path:string):Promise<HTMLCanvasElement>{
  const response=await fetch(new URL('./'+path,document.baseURI));if(!response.ok)throw Error(`无法读取水彩纹理：${path}`);
  const bitmap=await createImageBitmap(await response.blob());
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0,512,512);bitmap.close();return canvas;
}

async function loadAsset(path:string,maxSize=512):Promise<HTMLCanvasElement>{
  const response=await fetch(new URL('./'+path,document.baseURI));if(!response.ok)throw Error(`无法读取水彩素材：${path}`);
  const bitmap=await createImageBitmap(await response.blob()),scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return canvas;
}

export async function loadWatercolorTextures():Promise<void>{
  const directional=(kind:string)=>Promise.all(ART_DIRECTIONS.map((name,index)=>loadAsset(`assets/terrain/directional/watercolor-${kind}-${index}-${name}.png`)));
  const landDetailNames=['dense-forest','sparse-grove','rocky-grassland','meadow-trail','forest-boulders','woodland-thicket'];
  const [ocean,land,mountains,harbors,coasts,landDetails]=await Promise.all([
    loadTile('assets/terrain/watercolor-ocean.png'),
    loadTile('assets/terrain/watercolor-land.png'),
    directional('mountain'),
    directional('harbor'),
    directional('coast'),
    Promise.all(landDetailNames.map((name,index)=>loadAsset(`assets/terrain/land-details/watercolor-land-detail-${index}-${name}.png`))),
  ]);
  textures={ocean,land,mountains,harbors,coasts,landDetails};
}

export function watercolorTextures():WatercolorTextures {
  if(!textures)throw Error('水彩海图纹理尚未载入');return textures;
}
