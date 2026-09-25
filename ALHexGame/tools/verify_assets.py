"""Verify copied files, atlas dimensions, identity links, and animation coverage."""
import json
import struct
from collections import Counter
from pathlib import Path
from prepare_assets import ROOT, sha, skeleton_version, write_json


def main():
    roster = json.loads((ROOT / 'data/roster.json').read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'data/asset-manifest.json').read_text(encoding='utf-8'))
    issues, units = [], []
    for entry in manifest['files']:
        path = ROOT / entry['path']
        if not path.resolve().is_relative_to(ROOT) or path.is_symlink() or not path.is_file():
            issues.append('Missing or external file: ' + entry['path'])
        elif sha(path) != entry['sha256']:
            issues.append('Hash mismatch: ' + entry['path'])
    seen = set()
    for unit in roster['units']:
        if unit['id'] in seen:
            issues.append('Duplicate unit: ' + unit['id'])
        seen.add(unit['id'])
        folder = ROOT / unit['assets']['directory']
        version = skeleton_version(ROOT / unit['assets']['skeleton'])
        if version != unit['spine_version']:
            issues.append('Skeleton version mismatch: ' + unit['id'])
        lines = (ROOT / unit['assets']['atlas']).read_text(encoding='utf-8-sig').splitlines()
        pages = []
        for i, line in enumerate(lines):
            if not line or line[0].isspace() or ':' in line:
                continue
            if i + 1 < len(lines) and lines[i + 1].startswith('size:'):
                pages.append(line)
                page = folder / line
                if not page.is_file():
                    issues.append('Missing atlas page: ' + unit['id'] + '/' + line)
                    continue
                data = page.read_bytes()
                if data[:8] != b'\x89PNG\r\n\x1a\n':
                    issues.append('Invalid PNG: ' + unit['id'] + '/' + line)
                    continue
                actual = struct.unpack('>II', data[16:24])
                declared = tuple(int(n.strip()) for n in lines[i + 1].split(':', 1)[1].split(','))
                if actual != declared:
                    issues.append('Atlas size mismatch: ' + unit['id'] + '/' + line)
        if sorted(pages) != sorted(Path(p).name for p in unit['assets']['pages']):
            issues.append('Atlas page listing mismatch: ' + unit['id'])
        for action in ['idle', 'move', 'attack', 'skill', 'victory', 'defeated']:
            if unit['animation_map'].get(action) not in unit['animations']:
                issues.append('Missing required animation: ' + unit['id'] + '/' + action)
        units.append({'id': unit['id'], 'name': unit['name'], 'spine_version': version,
                      'animations': len(unit['animations']), 'missing_native_hurt': unit['animation_map']['hurt'] is None})
    report = {'status': 'passed' if not issues else 'failed', 'ships': len(units),
              'files_checked': len(manifest['files']), 'bytes': manifest['total_bytes'],
              'ship_types': dict(Counter(u['ship_type']['code'] for u in roster['units'])),
              'units': units, 'issues': issues,
              'scope': 'Static integrity only; actual playback report is browser-verification.json.'}
    write_json(ROOT / 'output/asset-verification.json', report)
    print(json.dumps(report, ensure_ascii=False))
    if issues:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
