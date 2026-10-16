#!/usr/bin/env python3
"""Crate "sounds like" tips (#2229) — turn the audio analysis into pile votes for the inbox.

    /Users/Shared/crate/venv/bin/python pocs/crate/scripts/audio/tips.py [--url …] [--dry-run]

For each inbox track that analyze.py has listened to: find the filed tracks that sound most
alike (cosine over the Discogs-EffNet embedding), let them vote with the piles they're in, and
upload that as the track's "Audio" tip — next to the Discogs/Bandcamp/agent tips, which stay.
Re-run any time: votes improve as more tracks get filed.

Env (pocs/crate/.env): CRATE_EMAIL, CRATE_PASSWORD, optional CRATE_URL.
"""
import argparse, http.cookiejar, json, os, unicodedata, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
for line in open(os.path.join(HERE, '..', '..', '.env')):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.strip().split('=', 1)
        os.environ.setdefault(k, v.strip('"\''))

p = argparse.ArgumentParser()
p.add_argument('--url', default=os.environ.get('CRATE_URL', 'https://crate-staging.pmcp.dev'))
p.add_argument('--features', default='/Users/Shared/crate/features')
p.add_argument('--library-list', default='/Users/Shared/crate/library.txt')
p.add_argument('--styles', default='/Users/Shared/crate/models/discogs-effnet-bs64-1.json')
p.add_argument('--team')
p.add_argument('-k', type=int, default=10)
p.add_argument('--dry-run', action='store_true')
args = p.parse_args()

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def api(path, body=None):
    req = urllib.request.Request(args.url + path, method='POST' if body is not None else 'GET',
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'Origin': args.url, 'User-Agent': 'crate-audio-tips'})
    with opener.open(req) as r:
        return json.load(r)


api('/api/auth/sign-in/email', {'email': os.environ['CRATE_EMAIL'], 'password': os.environ['CRATE_PASSWORD']})
teams = api('/api/auth/organization/list')
team = next(t for t in teams if not args.team or args.team in (t['slug'], t['id']))
base = f"/api/teams/{team['id']}/crate"
lib = api(base + '/library')
paths = {r['id']: r['audioPath'] for r in api(base + '/audio-paths')}

# Features are keyed by the path under the rekordbox contents folder; audioPath carries the
# Dropbox prefix (/rekordbox/contents_…/) in front of the same path.
norm = lambda s: unicodedata.normalize('NFC', s).lower()
rel_of = {i: norm(a.split('/', 3)[-1]) for i, a in paths.items() if a}
# Tell analyze.py which files rekordbox actually uses, so it skips the copies next to them.
with open(args.library_list, 'w') as out:
    out.writelines(r + '\n' for r in sorted(set(rel_of.values())))
index = {norm(k): v for k, v in json.load(open(os.path.join(args.features, 'index.json'))).items()}
def features_for(track_id):
    rel = rel_of.get(track_id)
    entry = rel and index.get(rel)
    return entry and entry.get('npz') and np.load(os.path.join(args.features, entry['npz']))

piles = {pl['name'].lower(): pl['name'] for pl in lib['piles']}
filed, inbox = [], []
for t in lib['tracks']:
    f = features_for(t['id'])
    if f is None:
        continue
    own = [piles[x.lower()] for x in t['tags'] if x.lower() in piles]
    (filed if own else inbox if all(x == 'NEW' for x in t['tags']) else []).append((t, own, f))

E = np.stack([f['emb'].astype(np.float32) for _, _, f in filed])
E /= np.linalg.norm(E, axis=1, keepdims=True)
labels = [c.split('---')[-1] for c in json.load(open(args.styles))['classes']]
print(f'{len(filed)} filed and {len(inbox)} inbox tracks have been listened to')

tips = []
for t, _, f in inbox:
    e = f['emb'].astype(np.float32)
    sim = E @ (e / np.linalg.norm(e))
    near = np.argsort(-sim)[:args.k]
    votes, total = {}, float(sim[near].sum())
    for i in near:
        for pile in set(filed[i][1]):
            votes[pile] = votes.get(pile, 0) + float(sim[i]) / total
    act = f['act'].astype(np.float32)
    tips.append({'trackId': t['id'], 'result': {
        'level': 'track',
        'styles': [[pile, round(share, 3)] for pile, share in sorted(votes.items(), key=lambda v: -v[1])[:6] if share >= 0.2],
        'genres': [[labels[i], round(float(act[i]), 3)] for i in np.argsort(-act)[:3] if act[i] >= 0.1],
        'neighbours': [f"{filed[i][0]['artist']} – {filed[i][0]['name']}" for i in near[:3]]
    }})

if args.dry_run:
    for tip in tips[:5]:
        t = next(x for x, _, _ in inbox if x['id'] == tip['trackId'])
        print(f"{t['artist']} – {t['name']}\n  piles: {tip['result']['styles']}\n  styles: {tip['result']['genres']}\n  near: {tip['result']['neighbours']}")
    raise SystemExit
merged = 0
for i in range(0, len(tips), 200):
    merged += api(base + '/tips', {'source': 'Audio', 'tips': tips[i:i + 200]})['tipsMerged']
print(f'Uploaded "sounds like" tips for {merged} inbox tracks')
