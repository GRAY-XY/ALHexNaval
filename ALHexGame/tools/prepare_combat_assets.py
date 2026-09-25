"""Copy representative original battle textures; never modify the source library."""
from pathlib import Path
import json, shutil, hashlib
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'ALChibiAssets'
items = {item['id']: item for item in json.loads((SOURCE/'battle-library.json').read_text('utf-8'))['items']}
selection = {
    'shell': 'item__bullet1', 'torpedo': 'item__torpedo01', 'bomb': 'item__bomberbombwhite',
    'us-fighter': 'chargo__f4f', 'us-bomber': 'chargo__sbdwuwei', 'us-torpedo': 'chargo__tbd',
    'uk-fighter': 'chargo__haipenhuo', 'uk-bomber': 'chargo__haiyan', 'uk-torpedo': 'chargo__jianyu',
    'jp-fighter': 'chargo__lingzhan21', 'jp-bomber': 'chargo__99shijianbao1', 'jp-torpedo': 'chargo__97jiangong',
    'de-fighter': 'chargo__bf109t', 'de-bomber': 'chargo__ju87c', 'de-torpedo': 'chargo__ju87d4',
}
target = ROOT/'assets/combat'
target.mkdir(parents=True, exist_ok=True)
manifest = []
for key, item_id in selection.items():
    item = items[item_id]
    images = [image for image in item['images'] if 'shadow' not in image['name'].lower()]
    assert images, item_id
    image = images[0]
    source = SOURCE/item['path']/image['file']
    dest = target/(key+'.png')
    shutil.copy2(source, dest)
    manifest.append({'id': key, 'sourceId': item_id, 'name': item['name'], 'source': str(source),
                     'path': 'assets/combat/'+dest.name, 'width': image['width'], 'height': image['height'],
                     'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()})
(ROOT/'data/combat-assets.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
print('Copied',len(manifest),'original textures:',sum((target/(key+'.png')).stat().st_size for key in selection),'bytes')
