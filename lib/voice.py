"""Narration for one job: edge-tts per sentence -> trim -> optional robot effect -> narration.wav + timeline.json + subtitles.srt

usage: voice.py <jobDir> <voice> <fx 0|1> <rate> <pitch>
Progress lines on stdout: "TTS <done> <total>".
"""
import array, asyncio, json, math, os, subprocess, sys, wave
import edge_tts

JOB, VOICE, USE_FX, RATE, PITCH = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4], sys.argv[5]
FPS, SR = 25, 48000
SPF = SR // FPS
LEAD, GAP, SCENE_GAP, TAIL = 0.6, 0.4, 0.9, 1.6
MOUTH_WIN = 3
AUD = os.path.join(JOB, "audio")

TRIM = ("silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,areverse,"
        "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,areverse")
# robot colour: natural voice + a quiet phase-zeroed layer + short metallic echo
FX = ("aresample=48000,asplit=2[dry][wet];"
      "[wet]afftfilt=real='hypot(re,im)':imag='0':win_size=512:overlap=0.75,volume=1.15[rob];"
      "[dry]volume=0.80[d];"
      "[d][rob]amix=inputs=2:normalize=0,aecho=0.9:0.9:9:0.22,highpass=f=110,alimiter=limit=0.95")
PLAIN = "aresample=48000,highpass=f=80,alimiter=limit=0.95"


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


async def synth(i, text, sem, done, total):
    raw, trim, out = (os.path.join(AUD, f"{n}_{i:03d}.{e}") for n, e in (("raw", "mp3"), ("trim", "wav"), ("fx", "wav")))
    async with sem:
        err = None
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(raw)
                if os.path.getsize(raw) > 1500:
                    err = None
                    break
            except Exception as e:  # noqa
                err = e
            await asyncio.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"配音失败（第 {i + 1} 句）：{err or '没有返回音频'}")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: ff("-i", raw, "-af", TRIM, "-ac", "1", trim))
        await loop.run_in_executor(None, lambda: ff("-i", trim, "-filter_complex" if USE_FX else "-af", FX if USE_FX else PLAIN,
                                                    "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", out))
        done[0] += 1
        print("TTS", done[0], total, flush=True)


def read_wav(p):
    w = wave.open(p, "rb")
    a = array.array("h"); a.frombytes(w.readframes(w.getnframes())); w.close()
    return a


def rms(a):
    return math.sqrt(sum(x * x for x in a) / len(a)) if len(a) else 0.0


def ts(t):
    return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round((t % 1) * 1000)) % 1000:03d}"


async def main():
    sb = json.load(open(os.path.join(JOB, "storyboard.json"), encoding="utf-8"))
    steps = [{"text": st["say"], "tts": st.get("tts") or st["say"], "scene": si}
             for si, sc in enumerate(sb["scenes"]) for st in sc.get("steps", [])]
    os.makedirs(AUD, exist_ok=True)
    sem, done = asyncio.Semaphore(4), [0]
    await asyncio.gather(*(synth(i, st["tts"], sem, done, len(steps)) for i, st in enumerate(steps)))

    track, mouth, out_steps = array.array("h"), [], []
    for k, st in enumerate(steps):
        clip = read_wav(os.path.join(AUD, f"fx_{k:03d}.wav"))
        lead_n = int(round(LEAD * FPS)) if k == 0 else 0
        last = k == len(steps) - 1
        pause = TAIL if last else (GAP if steps[k + 1]["scene"] == st["scene"] else SCENE_GAP)
        speech_n, pause_n = math.ceil(len(clip) / SPF), int(round(pause * FPS))
        f0 = len(track) // SPF
        seg = array.array("h", [0]) * (lead_n * SPF)
        seg.extend(clip)
        seg.extend(array.array("h", [0]) * ((lead_n + speech_n + pause_n) * SPF - len(seg)))
        track.extend(seg)
        wins = [rms(clip[i * SPF * MOUTH_WIN:(i + 1) * SPF * MOUTH_WIN]) for i in range(math.ceil(speech_n / MOUTH_WIN))]
        loud = sorted(w for w in wins if w > 0)
        thr = 0.55 * loud[len(loud) // 2] if loud else 1e9
        states, run = [], 0
        for w in wins:
            o = 1 if w > thr else 0
            run = run + 1 if o else 0
            if run > 2:
                o, run = 0, 0
            states.append(o)
        mouth += [0] * lead_n + [states[i // MOUTH_WIN] for i in range(speech_n)] + [0] * pause_n
        s = (f0 + lead_n) / FPS
        out_steps.append({"s": round(s, 3), "e": round(s + len(clip) / SR, 3),
                          "n": round((f0 + lead_n + speech_n + pause_n) / FPS, 3), "text": st["text"], "scene": st["scene"]})

    total = len(track) // SPF
    w = wave.open(os.path.join(JOB, "narration.wav"), "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(track.tobytes()); w.close()
    json.dump({"fps": FPS, "frames": total, "steps": out_steps, "mouth": mouth},
              open(os.path.join(JOB, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False)
    with open(os.path.join(JOB, "subtitles.srt"), "w", encoding="utf-8") as f:
        for i, st in enumerate(out_steps, 1):
            f.write(f"{i}\n{ts(st['s'])} --> {ts(st['e'])}\n{st['text']}\n\n")
    print("TIMELINE", total, round(total / FPS, 2), flush=True)


try:
    asyncio.run(main())
except Exception as e:  # noqa
    print("VOICE_FAILED", str(e), flush=True)
    sys.exit(1)
