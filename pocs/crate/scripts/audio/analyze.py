#!/usr/bin/env python3
"""Crate audio analysis (#2229) — listen to every track once, on the Mac that holds the music.

    python analyze.py --music "<rekordbox contents folder>" [--out /Users/Shared/crate/features] [--limit N]

For each audio file under --music it runs MTG's Discogs-EffNet model over the WHOLE track and
saves one small .npz (≈10 KB): the mean embedding (what it sounds like, for "sounds like your
filed tracks" votes), the mean Discogs-style scores, and style scores per 30 s window (so a
Latin intro or outro isn't averaged away). Files already analysed and unchanged are skipped,
so a nightly run only does new tracks.

It only reads music and writes features; matching tracks to piles happens elsewhere.
"""
import argparse, fcntl, hashlib, json, os, sys, time, unicodedata
import numpy as np

AUDIO = {'.mp3', '.m4a', '.aac', '.aif', '.aiff', '.wav', '.flac', '.ogg', '.alac'}
HERE = os.path.dirname(os.path.abspath(__file__))
SR, PATCH, HOP = 16000, 128, 62          # model input: 128 mel frames (~2 s), one patch per ~1 s
WINDOW_PATCHES = 30                      # ~30 s per window in the per-window style scores

p = argparse.ArgumentParser()
p.add_argument('--music', required=True)
p.add_argument('--out', default='/Users/Shared/crate/features')
p.add_argument('--model', default=os.path.join(HERE, 'models'))
p.add_argument('--limit', type=int, default=0, help='stop after N new tracks (0 = all)')
p.add_argument('--only', default=os.path.join(HERE, 'library.txt'),
               help='list of paths (one per line) that are in rekordbox; other files are skipped')
args = p.parse_args()

os.makedirs(args.out, exist_ok=True)
lock = open(os.path.join(args.out, '.lock'), 'w')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit('Another analysis run is still going.')

import essentia
essentia.log.warningActive = False
import essentia.standard as es
import onnxruntime as ort

sess = ort.InferenceSession(os.path.join(args.model, 'discogs-effnet-bsdynamic-1.onnx'))
mel = es.TensorflowInputMusiCNN()

index_path = os.path.join(args.out, 'index.json')
index = json.load(open(index_path)) if os.path.exists(index_path) else {}


def save_index():
    tmp = index_path + '.tmp'
    json.dump(index, open(tmp, 'w'))
    os.replace(tmp, index_path)


def analyse(path):
    audio = es.MonoLoader(filename=path, sampleRate=SR, resampleQuality=4)()
    if len(audio) < SR * 10:
        return None
    frames = np.array([mel(f) for f in es.FrameGenerator(audio, frameSize=512, hopSize=256, startFromZero=True)], dtype=np.float32)
    patches = np.stack([frames[i:i + PATCH] for i in range(0, len(frames) - PATCH + 1, HOP)])
    acts, embs = [], []
    for i in range(0, len(patches), 64):
        a, e = sess.run(None, {'melspectrogram': patches[i:i + 64]})
        acts.append(a); embs.append(e)
    act, emb = np.concatenate(acts), np.concatenate(embs)
    windows = np.stack([act[i:i + WINDOW_PATCHES].mean(0) for i in range(0, len(act), WINDOW_PATCHES)])
    return dict(emb=emb.mean(0).astype(np.float16), act=act.mean(0).astype(np.float16),
                windows=windows.astype(np.float16), seconds=np.float32(len(audio) / SR))


files = sorted(os.path.join(d, f) for d, _, fs in os.walk(args.music) for f in fs
               if os.path.splitext(f)[1].lower() in AUDIO and not f.startswith('._'))
# The contents folder also holds copies rekordbox doesn't use ("… (2).mp3" and the like —
# about half the folder). When tips.py has written the library list, only those are analysed.
norm = lambda s: unicodedata.normalize('NFC', s).lower()
wanted = {norm(l.rstrip('\n')) for l in open(args.only)} if os.path.exists(args.only) else None
if wanted:
    files = [f for f in files if norm(os.path.relpath(f, args.music)) in wanted]
todo = []
for f in files:
    rel = os.path.relpath(f, args.music)
    st = os.stat(f)
    known = index.get(rel)
    if not known or known.get('mtime') != int(st.st_mtime) or known.get('size') != st.st_size:
        todo.append((f, rel, st))
print(f'{len(files)} audio files, {len(files) - len(todo)} already done, {len(todo)} to analyse', flush=True)
if args.limit:
    todo = todo[:args.limit]

t0, done, failed = time.time(), 0, 0
for f, rel, st in todo:
    key = hashlib.sha1(rel.encode()).hexdigest()[:16]
    try:
        feats = analyse(f)
    except Exception as e:  # a broken or cloud-only file shouldn't stop the run
        failed += 1
        print(f'  ✗ {rel}: {e}', flush=True)
        continue
    if feats is None:
        index[rel] = dict(npz=None, mtime=int(st.st_mtime), size=st.st_size)
    else:
        np.savez(os.path.join(args.out, key + '.npz'), **feats)
        index[rel] = dict(npz=key + '.npz', mtime=int(st.st_mtime), size=st.st_size)
    done += 1
    if done % 25 == 0:
        save_index()
        rate = (time.time() - t0) / done
        print(f'  {done}/{len(todo)} · {rate:.1f}s/track · ~{(len(todo) - done) * rate / 60:.0f} min left', flush=True)
save_index()
print(f'Done: {done} analysed, {failed} failed, {time.time() - t0:.0f}s', flush=True)
