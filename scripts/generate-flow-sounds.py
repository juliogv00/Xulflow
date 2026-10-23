"""Reproduce VMNTe flow's original, quiet PCM earcons with Python's standard library.

Legacy filenames preserve saved sound_theme values and custom-sound behavior.
Crystal replaces Marimba; Felt replaces Pop. No external samples are used.
The start tone stays under 200 ms because capture waits for playback to finish.
"""
import math
from pathlib import Path
import struct
import wave

RATE = 48000
ROOT = Path(__file__).resolve().parent.parent / "src-tauri/resources"


def render(name, duration, notes, felt=False):
    samples = []
    for i in range(round(duration * RATE)):
        t = i / RATE
        value = 0.0
        for frequency, offset, strength in notes:
            age = t - offset
            if age < 0:
                continue
            attack = 1 - math.exp(-age / 0.006)
            release = math.exp(-age / (0.047 if felt else 0.065))
            tone = math.sin(2 * math.pi * frequency * age)
            tone += (0.07 if felt else 0.16) * math.sin(2 * math.pi * frequency * 2.003 * age) * math.exp(-age / 0.03)
            tone += 0.035 * math.sin(2 * math.pi * frequency * 3.997 * age) * math.exp(-age / 0.02)
            value += strength * attack * release * tone
        # Smooth tail, no discontinuity/click at the final sample.
        tail = min(1.0, max(0.0, (duration - t) / 0.025))
        value *= math.sin(tail * math.pi / 2) ** 2
        samples.append(value)
    peak = max(abs(v) for v in samples)
    gain = 0.24 / peak
    pcm = b"".join(struct.pack("<h", round(v * gain * 32767)) for v in samples)
    with wave.open(str(ROOT / name), "wb") as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(RATE)
        sound.writeframes(pcm)
    print(f"{name}: {duration:.3f}s, peak -12.4 dBFS")


render("marimba_start.wav", .19, [(698.46, 0, 1), (1046.5, .045, .45)])
render("marimba_stop.wav", .28, [(1046.5, 0, .45), (698.46, .055, .75), (523.25, .085, .3)])
render("pop_start.wav", .16, [(523.25, 0, 1), (783.99, .035, .28)], felt=True)
render("pop_stop.wav", .24, [(659.25, 0, .5), (440, .045, .8)], felt=True)


def render_signature(theme, event, duration, frequency):
    """Distinct physical/synth timbres; all starts fit within 200 ms."""
    samples = []
    noise_state = 173
    air = 0.0
    for i in range(round(duration * RATE)):
        t = i / RATE
        progress = t / duration
        # Deterministic, softly filtered noise, used only by the airy signature.
        noise_state = (1664525 * noise_state + 1013904223) & 0xffffffff
        air += 0.09 * ((noise_state / 0xffffffff * 2 - 1) - air)
        attack_time = 0.018 if theme in ('silk', 'air') else 0.004
        decay = 0.085 if theme in ('silk', 'orbit', 'air') else 0.045
        envelope = (1 - math.exp(-t / attack_time)) * math.exp(-t / decay)
        phase = 2 * math.pi * frequency * t
        if theme == 'droplet':
            # Falling pitch, like a small drop landing on a water surface.
            glide = 2 * math.pi * frequency * 0.55 * 0.018 * (1 - math.exp(-t / 0.018))
            tone = math.sin(phase + glide) + 0.12 * math.sin(phase * 2 + glide)
        elif theme == 'silk':
            tone = (math.sin(phase) + 0.38 * math.sin(phase * 1.5)
                    + 0.22 * math.sin(phase * 2.002)) * (0.75 + 0.25 * math.sin(math.pi * progress))
        elif theme == 'wood':
            # Short, inharmonic modes resemble a muted wooden instrument.
            tone = (math.sin(phase) + 0.5 * math.sin(phase * 2.76) * math.exp(-t / 0.018)
                    + 0.23 * math.sin(phase * 5.4) * math.exp(-t / 0.009))
        elif theme == 'orbit':
            tone = math.sin(phase + 1.4 * math.sin(phase * 2) * math.exp(-t / 0.035))
            tone += 0.3 * math.sin(phase * 1.498) * (1 - math.exp(-t / 0.025))
        elif theme == 'air':
            tone = 0.65 * math.sin(phase) + 0.2 * math.sin(phase * 2) + air * 0.8
        elif theme == 'pulse':
            # Round, low electronic tap with a tiny pitch bend.
            tone = math.sin(phase + 1.8 * (1 - math.exp(-t / 0.012)))
            tone += 0.12 * math.sin(phase * 2) * math.exp(-t / 0.025)
        else:
            raise ValueError(theme)
        # Exactly silent endpoints, with a smooth final 30 ms fade.
        tail = min(1.0, max(0.0, (duration - t - 1 / RATE) / 0.03))
        samples.append(tone * envelope * math.sin(tail * math.pi / 2) ** 2)
    peak = max(abs(v) for v in samples)
    pcm = b''.join(struct.pack('<h', round(v * 0.24 / peak * 32767)) for v in samples)
    name = f'{theme}_{event}.wav'
    with wave.open(str(ROOT / name), 'wb') as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(RATE)
        sound.writeframes(pcm)
    print(f'{name}: {duration:.3f}s, peak -12.4 dBFS')


for theme, start_hz, stop_hz, start_duration, stop_duration in [
    ('droplet', 880, 587.33, .17, .23),
    ('silk', 440, 329.63, .19, .29),
    ('wood', 740, 493.88, .14, .20),
    ('orbit', 659.25, 440, .18, .27),
    ('air', 1174.66, 783.99, .19, .28),
    ('pulse', 293.66, 196, .13, .19),
]:
    render_signature(theme, 'start', start_duration, start_hz)
    render_signature(theme, 'stop', stop_duration, stop_hz)
