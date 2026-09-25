import collections,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'library.json').read_text(encoding='utf-8'))
issues=[];ids=[];paths=[];file_count=0
for c in data['characters']:
    for s in c['skins']:
        ids.append(s['id']);paths.append(s['path']);folder=(ROOT/s['path']).resolve()
        if not folder.is_relative_to(ROOT.resolve()):issues.append('outside library: '+s['id']);continue
        if folder.is_symlink():issues.append('linked folder: '+s['id'])
        for filename in [s['skel'],s['atlas'],*s['pages']]:
            p=(folder/filename).resolve()
            if not p.is_relative_to(folder) or not p.is_file():issues.append('missing or external file: '+s['id']+'/'+filename)
        if not (ROOT/s['preview']).is_file():issues.append('missing preview: '+s['id'])
        file_count+=len(list(folder.iterdir()))
        if c['faction_id']!=-1 and c['kind']!='character':issues.append('unexpected faction: '+c['id'])
duplicates=[key for key,n in collections.Counter(ids).items() if n>1]
for filename in ['index.html','app.js','app.css','library.js','vendor/pixi.min.js','vendor/pixi-spine.js','tools/server.py','启动素材库.bat']:
    if not (ROOT/filename).is_file():issues.append('missing runtime file: '+filename)
for filename in ['index.html','app.js','app.css','tools/server.py','启动素材库.bat']:
    text=(ROOT/filename).read_text(encoding='utf-8-sig')
    if 'ChibiAssets_20260917' in text:issues.append('runtime depends on extraction directory: '+filename)
    if re.search(r'https?://(?!127\.0\.0\.1)',text):issues.append('remote runtime reference: '+filename)
javelin=next(c for c in data['characters'] if c['id']=='20121')
if javelin['faction_id']!=2 or not {'biaoqiang','biaoqiang_3','biaoqiang_10'}.issubset({s['id'] for s in javelin['skins']}):issues.append('Javelin identity or skin grouping incorrect')
nier=[c for c in data['characters'] if c['faction_id']==117]
if not any(c['name']=='2B' and len(c['skins'])==2 for c in nier):issues.append('2B grouping incorrect')
report={'characters':data['summary']['characters'],'other_groups':data['summary']['other_groups'],'materials':len(ids),'unique_skin_folders':len(set(paths)),'files_in_skin_folders':file_count,'duplicate_material_ids':duplicates,'issues':issues,'javelin_skins':len(javelin['skins']),'source_metadata':'AzurLaneTools/AzurLaneLuaScripts CN snapshots stored in metadata','independent_runtime':not any('runtime' in x for x in issues)}
(ROOT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
if issues or duplicates:raise SystemExit(1)
