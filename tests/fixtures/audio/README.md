# Audio test fixtures

These small self-authored fixtures exercise real browser decoding without external media or runtime dependencies:

- `tone.wav`: two seconds of mono 440 Hz PCM16 at 8 kHz, generated with `ffmpeg -f lavfi -i 'sine=frequency=440:duration=2' -ar 8000 -ac 1 -c:a pcm_s16le tone.wav`.
- `tone.ogg`: that WAV encoded with FFmpeg's native Vorbis encoder using `ffmpeg -i tone.wav -c:a vorbis -strict experimental -ac 2 tone.ogg`.
- `tone.mp3`: eighty self-authored silent MPEG-1 Layer III frames. Each 417-byte frame has header `ff fb 90 64` followed by 413 zero bytes (zero side information and spectral data), at 128 kbit/s, 44.1 kHz stereo. FFmpeg and the browser decoder validate the stream. No third-party recording is included.

The MP3 fixture is silent; tests verify playback node lifecycle rather than audible output. Fixtures contain no authored character or scene data.
