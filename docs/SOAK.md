# Soak test — docs/SOAK.md

- Date: 2026-09-15T21:57:00.539Z
- Machine: Windows 11, 1366x768 display
- Duration: 10.00 min (target 10 min)
- Iterations: 120
- Console/main-process errors: 0

## Process memory (app.getAppMetrics(), at end of soak)

| process type | pid | workingSetSize (MB) | privateBytes (MB) |
| --- | --- | --- | --- |
| Browser | 9828 | 124.8 | 83.0 |
| GPU | 45128 | 116.9 | 104.3 |
| Utility | 14280 | 41.6 | 11.8 |
| Tab | 42904 | 81.6 | 29.5 |
| Tab | 32856 | 81.3 | 35.5 |
| Tab | 40380 | 88.3 | 37.7 |


