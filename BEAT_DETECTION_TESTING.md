# Beat Detection Testing Notes

## Problem
Optimizing beat detection for one genre (e.g., plugg/808-heavy) might worsen detection for others.

## Recommended Test Playlist

| Genre | Example Artists | Characteristics |
|-------|-----------------|-----------------|
| Pop | Dua Lipa, The Weeknd | Clear 4/4 beats, easy baseline |
| EDM/House | Any house track | Strong kicks, consistent BPM |
| Hip-hop/Trap | Travis Scott, Playboi Carti | 808s, hi-hats, syncopation |
| Lo-fi/Chill | Lo-fi beats, Joji | Subtle beats, vinyl crackle |
| Plugg/Rage | Nettspend, Yeat, Ken Carson | Sparse, heavy FX, slow tempo |
| Rock | Arctic Monkeys, RHCP | Live drums, less quantized |
| Slowed/Reverb | Any slowed edit | Tests low BPM detection |

## What to Measure
- [ ] Does it feel on-beat when playing?
- [ ] BPM accuracy (compare to known BPM)
- [ ] Note density (not too many, not too few)
- [ ] No obvious off-beats

## Future: Debug Logging
Add optional debug output:
```
Track: song.mp3
Detected BPM: 85
Raw beats found: 127
Bass beats found: 45
Final grid beats: 89
Coverage: 73%
```

## Current Detection Methods
1. **Energy-based** - RMS energy peaks (good for general use)
2. **Bass-focused** - Low-pass filtered for 808s (added for plugg)
3. **Grid alignment** - Snaps detected beats to BPM grid

## Known Issues
- Plugg/sparse tracks may have too few detected beats
- Very slow tracks (< 65 BPM) get doubled
- Heavy reverb can blur transients
