"""Copy the first roster into a self-contained project, without changing originals."""
import csv
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'ALChibiAssets'
RENDER_LOG = SOURCE / 'metadata/render.jsonl'
SELECTION = [
    ('10117', 'lafei', '拉菲', '持续炮击与机动'),
    ('20121', 'biaoqiang', '标枪', '侦察与抢点'),
    ('30105', 'lingbo', '绫波', '鱼雷突击'),
    ('40123', 'z23', 'Z23', '炮击型驱逐'),
    ('10205', 'hailunna', '海伦娜', '侦察辅助'),
    ('20212', 'beierfasite', '贝尔法斯特', '烟幕与护航'),
    ('30311', 'gaoxiong', '高雄', '炮雷结合'),
    ('40303', 'ougen', '欧根亲王', '前线承伤'),
    ('20502', 'yanzhan', '厌战', '远程炮击'),
    ('40501', 'bisimai', '俾斯麦', '主力炮击'),
    ('10706', 'qiye', '企业', '航空打击'),
    ('20603', 'dujiaoshou', '独角兽', '航空与支援'),
]
TYPES = {1: ('DD', '驱逐舰'), 2: ('CL', '轻巡洋舰'), 3: ('CA', '重巡洋舰'),
         5: ('BB', '战列舰'), 6: ('CVL', '轻型航空母舰'), 7: ('CV', '航空母舰')}
ARMOR = {1: '轻型', 2: '中型', 3: '重型'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def skeleton_version(path):
    data = path.read_bytes()
    pos = 0
    strings = []
    for _ in range(2):
        size = shift = 0
        while True:
            byte = data[pos]
            pos += 1
            size |= (byte & 127) << shift
            if not byte & 128:
                break
            shift += 7
            if shift > 28:
                raise ValueError('Invalid Spine string header')
        strings.append(data[pos:pos + max(0, size - 1)].decode('utf-8'))
        pos += max(0, size - 1)
    return strings[1]


def copy_identical(src, dst, records, origin):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        if sha(dst) != sha(src):
            raise RuntimeError(f'Refusing to replace changed file: {dst}')
    else:
        shutil.copy2(src, dst)
    records.append({'path': dst.relative_to(ROOT).as_posix(), 'bytes': dst.stat().st_size,
                    'sha256': sha(dst), 'source': origin})


def animation_map(names):
    def pick(*choices):
        return next((name for name in choices if name in names), None)
    return {'idle': pick('stand', 'idle', 'normal'), 'move': pick('move', 'walk'),
            'move_left': pick('move_left'), 'attack': pick('attack'),
            'attack_left': pick('attack_left'), 'main_gun': pick('attack_main', 'attack'),
            'skill': pick('skill'), 'victory': pick('victory'),
            'defeated': pick('dead'), 'hurt': pick('hurt', 'hit', 'damage')}


def main():
    library = json.loads((SOURCE / 'library.json').read_text(encoding='utf-8'))
    statistics = json.loads((SOURCE / 'metadata/ships.json').read_text(encoding='utf-8'))
    render_log = {}
    for line in RENDER_LOG.read_text(encoding='utf-8').splitlines():
        row = json.loads(line)
        render_log[(row['id'], row['skeleton'])] = row
    characters = {row['id']: row for row in library['characters']}
    records, units, source_rows = [], [], []
    for group_id, unit_id, name, hint in SELECTION:
        character = characters[group_id]
        assert character['name'] == name and character['kind'] == 'character'
        skins = [s for s in character['skins'] if s['id'] == unit_id
                 and s['match'] == 'exact' and s['group_index'] == 0]
        assert len(skins) == 1, f'Missing or ambiguous default skin: {unit_id}'
        skin = skins[0]
        candidates = sorted((v for k, v in statistics.items() if int(k) // 10 == int(group_id)),
                            key=lambda v: v['id'])
        stats = candidates[0]
        assert stats['nationality'] == character['faction_id']
        type_code, type_name = TYPES[stats['type']]
        folder = ROOT / 'assets/ships' / unit_id / 'default'
        source_folder = SOURCE / skin['path']
        file_names = [skin['skel'], skin['atlas'], *skin['pages'], Path(skin['preview']).name]
        for filename in file_names:
            copy_identical(source_folder / filename, folder / filename, records,
                           'ALChibiAssets/' + skin['path'] + '/' + filename)
        version = skeleton_version(folder / skin['skel'])
        assert version.startswith('3.8.'), f'Unexpected Spine version: {unit_id}: {version}'
        prior = render_log[(unit_id, skin['skel'])]
        assert prior['status'] == 'ok'
        names = prior['animations']
        base = folder.relative_to(ROOT).as_posix()
        unit = {'id': unit_id, 'ship_group': int(group_id), 'name': name,
                'faction': {'id': character['faction_id'], 'name': character['faction']},
                'ship_type': {'source_code': stats['type'], 'code': type_code, 'name': type_name},
                'original_armor': {'code': stats['armor_type'], 'name': ARMOR[stats['armor_type']]},
                'skin': {'id': skin['skin_id'], 'name': skin['name'], 'kind': 'default'},
                'assets': {'directory': base, 'skeleton': base + '/' + skin['skel'],
                           'atlas': base + '/' + skin['atlas'],
                           'pages': [base + '/' + page for page in skin['pages']],
                           'preview': base + '/' + Path(skin['preview']).name},
                'spine_version': version, 'animations': names, 'animation_map': animation_map(names),
                'animation_evidence': 'copied-source-log; current browser verification in output/',
                'fallbacks': {'hurt': 'keep current animation; game renderer adds flash/shake',
                              'missing_left': 'mirror the corresponding right-facing animation'},
                'design_hint': hint + '（初步方向，未写入战斗数值）'}
        units.append(unit)
        source_rows.append({'unit_id': unit_id, 'ship_group': int(group_id), 'statistics_id': stats['id'],
                            'type': stats['type'], 'nationality': stats['nationality'],
                            'armor_type': stats['armor_type'], 'skin_id': skin['skin_id'],
                            'source_directory': skin['path'], 'source_bundle_sha256': skin['source_sha256']})
    dependencies = [
        (SOURCE / 'vendor/pixi.min.js', ROOT / 'preview/vendor/pixi.min.js'),
        (SOURCE / 'vendor/pixi-spine.js', ROOT / 'preview/vendor/pixi-spine.js'),
        (SOURCE / 'vendor/PIXI-LICENSE.txt', ROOT / 'preview/vendor/PIXI-LICENSE.txt'),
        (SOURCE / 'vendor/SPINE-LICENSE.txt', ROOT / 'preview/vendor/SPINE-LICENSE.txt'),
    ]
    for src, dst in dependencies:
        copy_identical(src, dst, records, src.relative_to(ROOT.parent).as_posix())
    roster = {'schema_version': 1, 'stage': '01-assets', 'units': units,
              'runtime': {'pixi': '7.4.3', 'pixi_spine': '4.0.6', 'spine': '3.8'},
              'notes': ['Identity and ship type are from the local metadata snapshot.',
                        'Faction describes the character origin, not the match team.',
                        'No combat balance stats are imported from the original game.',
                        'All units have the original default skin, not remodel variants.']}
    write_json(ROOT / 'data/roster.json', roster)
    write_json(ROOT / 'data/source-receipts.json', {
        'source_library': 'ALChibiAssets/library.json', 'source_library_sha256': sha(SOURCE / 'library.json'),
        'source_statistics': 'ALChibiAssets/metadata/ships.json',
        'source_statistics_sha256': sha(SOURCE / 'metadata/ships.json'), 'units': source_rows})
    for path in [ROOT / 'data/roster.json', ROOT / 'data/source-receipts.json']:
        records.append({'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
                        'sha256': sha(path), 'source': 'generated curated metadata'})
    write_json(ROOT / 'data/asset-manifest.json', {'schema_version': 1,
        'prepared_at': datetime.now(timezone.utc).isoformat(), 'files': records,
        'total_bytes': sum(row['bytes'] for row in records)})
    with (ROOT / '素材清单.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['ID', '舰船', '阵营', '舰种', '皮肤', 'Spine版本', '动作数', '素材目录'])
        for u in units:
            writer.writerow([u['id'], u['name'], u['faction']['name'], u['ship_type']['name'],
                             u['skin']['name'], u['spine_version'], len(u['animations']), u['assets']['directory']])
    print(json.dumps({'ships': len(units), 'files': len(records),
                      'bytes': sum(row['bytes'] for row in records)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
