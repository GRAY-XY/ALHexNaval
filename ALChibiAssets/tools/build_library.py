import collections,csv,hashlib,json,os,re,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(os.environ.get('AL_CHIBI_EXTRACT_DIR',ROOT.parent/'ChibiAssets_20260917'))
META=ROOT/'metadata'

def field(block,key,default=None):
    m=re.search(r'^\s*'+re.escape(key)+r' = ("(?:\\.|[^"\\])*"|-?\d+),?\s*$',block,re.M)
    if not m:return default
    return json.loads(m.group(1))

def table(name,fields):
    text=(META/(name+'.lua')).read_text(encoding='utf-8')
    split=re.split(r'(?:_G\.)?pg\.base\.'+name+r'\[(\d+)\] = \{',text)
    return {int(split[i]):{k:field(split[i+1],k) for k in fields} for i in range(1,len(split),2)}

def safe(name):return re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(name)).strip(' .')[:65]
def copy(src,dest):
    if not dest.exists() or src.stat().st_size!=dest.stat().st_size or src.stat().st_mtime_ns!=dest.stat().st_mtime_ns:shutil.copy2(src,dest)

skins=table('ship_skin_template',['id','name','prefab','ship_group','group_index','skin_type'])
ships=table('ship_data_statistics',['id','name','nationality','skin_id'])
names=table('name_code',['name','code'])
def resolve(name):return re.sub(r'\{namecode:(\d+)\}',lambda m:names.get(int(m.group(1)),{}).get('name') or m.group(0),name or '')
text=(META/'gametip.lua').read_text(encoding='utf-8')
tips={m.group(1):json.loads(m.group(2)) for m in re.finditer(r'_G\.pg\.base\.gametip\.(word_shipNation_\w+) = \{\s*tip = ("(?:\\.|[^"\\])*")',text)}
code_keys={0:'other',1:'baiYing',2:'huangJia',3:'chongYing',4:'tieXue',5:'dongHuang',6:'saDing',7:'beiLian',8:'ziyou',9:'weixi',10:'yuanwei',11:'yujinwangguo',12:'jinghuanlianmeng',96:'mot',97:'meta',98:'other',99:'siren',101:'np',102:'bili',103:'um',104:'ai',105:'holo',106:'doa',107:'imas',108:'ssss',109:'ryza',110:'senran',111:'tolove',112:'brs',113:'yumia',114:'danmachi',115:'dal',117:'nierautomata'}
factions={code:tips.get('word_shipNation_'+key,'塞壬' if code==99 else f'阵营 {code}') for code,key in code_keys.items()}
factions[97]='META'
factions[-1]='未识别 / 其他'
by_prefab=collections.defaultdict(list)
for sid,s in skins.items():
    if s['prefab']:by_prefab[s['prefab'].lower()].append(s)
valid_groups={sid//10 for sid in ships}
def choose(options):return min(options,key=lambda s:(s['ship_group'] not in valid_groups,s['id']))
prefab_map={p:choose(v) for p,v in by_prefab.items()}
base_skins={g:skins.get(g*10) or min((s for s in skins.values() if s['ship_group']==g),key=lambda s:s['id']) for g in {s['ship_group'] for s in skins.values() if s['ship_group'] is not None}}
ship_groups=collections.defaultdict(list)
for sid,s in ships.items():ship_groups[sid//10].append(s)

def associate(id):
    if id in prefab_map:return prefab_map[id],'exact'
    candidate=re.sub(r'^(gift_|takegift_|chess_)','',id)
    candidate=re.sub(r'_hx$','',candidate)
    if candidate in prefab_map:return prefab_map[candidate],'variant'
    matches=[p for p in prefab_map if candidate.startswith(p+'_')]
    if matches:return prefab_map[max(matches,key=len)],'variant'
    return None,'unidentified'

manifest=json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'))
groups={};records=[];copy_count=0;keep_folders=set()
for row in manifest:
    if row['id']=='none':continue
    skin,method=associate(row['id'].lower())
    if skin:
        group_id=skin['ship_group'];key=str(group_id);base=base_skins[group_id]
        stats=sorted(ship_groups.get(group_id,[]),key=lambda s:s['id'])
        nation=stats[0]['nationality'] if stats else -1
        title=resolve(base['name']);base_prefab=base['prefab'];kind='character'
        skin_name=resolve(skin['name']) if method=='exact' else ('特殊素材 · '+row['id'])
    else:
        family=re.sub(r'(?:_\d+|_[gh])$','',row['id'])
        key='other_'+family;group_id=None;nation=-1;title=family;base_prefab=family;kind='other'
        skin_name=row['id']
    faction=factions.get(nation,f'阵营 {nation}')
    folder=Path('assets')/safe(faction)/(safe(key)+'_'+safe(title))/'skins'/safe(row['id'])
    dest=ROOT/folder;dest.mkdir(parents=True,exist_ok=True);keep_folders.add(dest.resolve())
    for src in (SOURCE/'models'/row['id']).iterdir():
        if src.is_file():copy(src,dest/src.name);copy_count+=1
    group=groups.setdefault(key,{'id':key,'name':title,'faction_id':nation,'faction':faction,'kind':kind,'prefab':base_prefab,'skins':[]})
    for model in row['models']:
        preview_name=row['id']+('__'+model['skeleton'][:-5] if len(row['models'])>1 else '')
        preview_file='__preview'+('__'+model['skeleton'][:-5] if len(row['models'])>1 else '')+'.png'
        copy(SOURCE/'previews'/(preview_name+'.png'),dest/preview_file);copy_count+=1
        entry={'id':row['id'],'name':skin_name,'match':method,'skin_id':skin['id'] if skin and method=='exact' else None,'group_index':skin['group_index'] if skin and method=='exact' else None,'path':folder.as_posix(),'skel':model['skeleton'],'atlas':model['atlas'],'pages':model['pages'],'preview':(folder/preview_file).as_posix(),'source_sha256':row['sha256']}
        group['skins'].append(entry);records.append(entry)
for group in groups.values():
    group['skins'].sort(key=lambda s:(s['match']!='exact',s['group_index'] if s['group_index'] is not None else 999,s['id']))
    group['preview']=next((s['preview'] for s in group['skins'] if s['id']==group['prefab']),group['skins'][0]['preview'])
data={'version':2,'characters':sorted(groups.values(),key=lambda g:(g['faction_id']==-1,g['kind']!='character',g['faction_id'],g['name'])),'factions':[{'id':n,'name':factions.get(n,f'阵营 {n}'),'characters':sum(g['faction_id']==n for g in groups.values()),'skins':sum(len(g['skins']) for g in groups.values() if g['faction_id']==n)} for n in sorted({g['faction_id'] for g in groups.values()},key=lambda n:(n==-1,n))],'summary':{'characters':sum(g['kind']=='character' for g in groups.values()),'other_groups':sum(g['kind']=='other' for g in groups.values()),'materials':len(records),'copied_files':copy_count,'exact':sum(r['match']=='exact' for r in records),'variants':sum(r['match']=='variant' for r in records),'unidentified':sum(r['match']=='unidentified' for r in records)}}
(ROOT/'library.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'library.js').write_text('window.AL_LIBRARY='+json.dumps(data,ensure_ascii=False).replace('</','<\\/')+';',encoding='utf-8')
with (ROOT/'素材索引.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['阵营','角色','皮肤或特殊素材','内部名称','归类方式','独立素材路径'])
    for g in data['characters']:
        for s in g['skins']:w.writerow([g['faction'],g['name'],s['name'],s['id'],s['match'],s['path']])
print(json.dumps(data['summary'],ensure_ascii=False));print('Nier',[(g['name'],g['faction'],len(g['skins'])) for g in groups.values() if g['faction_id']==117])
asset_root=(ROOT/'assets').resolve()
for stale in asset_root.glob('*/*/skins/*'):
    resolved=stale.resolve()
    if resolved not in keep_folders:
        if not resolved.is_relative_to(asset_root):raise RuntimeError('Cleanup escaped independent library')
        shutil.rmtree(resolved)
for parent in sorted(asset_root.glob('**/*'),key=lambda p:len(p.parts),reverse=True):
    if parent.is_dir() and not any(parent.iterdir()):parent.rmdir()
