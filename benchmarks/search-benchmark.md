# Minimax vs. MCTS Search Benchmarks

Generated: 2026-08-15T11:33:04.337Z  
Runtime: v22.13.0 linux/x64  
Samples per row: 5; warmups per row: 2

Timing is wall-clock generation time for the local trace builders. Lower average milliseconds is faster; work-units/sec uses evaluated leaves for Minimax and rollout iterations for MCTS.

| Position | Algorithm | Depth | Avg ms | Min ms | Max ms | Nodes | Evaluated / rollouts | Work units/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| opening response | minimax | 1 | 2.955 | 2.021 | 4.292 | 6 | 5 | 1692 |
| opening response | mcts | 1 | 25.243 | 24.473 | 26.091 | 25 | 24 | 951 |
| opening response | minimax | 2 | 8.118 | 7.659 | 8.822 | 31 | 10 | 1232 |
| opening response | mcts | 2 | 90.410 | 86.891 | 101.041 | 49 | 48 | 531 |
| opening response | minimax | 3 | 21.187 | 20.886 | 21.503 | 86 | 44 | 2077 |
| opening response | mcts | 3 | 173.411 | 171.127 | 176.326 | 73 | 72 | 415 |
| opening response | minimax | 4 | 78.389 | 77.416 | 79.980 | 311 | 109 | 1391 |
| opening response | mcts | 4 | 287.273 | 282.827 | 292.362 | 97 | 96 | 334 |
| developed middlegame | minimax | 1 | 2.492 | 2.239 | 3.075 | 6 | 5 | 2006 |
| developed middlegame | mcts | 1 | 39.276 | 38.654 | 39.982 | 25 | 24 | 611 |
| developed middlegame | minimax | 2 | 9.459 | 9.346 | 9.559 | 31 | 18 | 1903 |
| developed middlegame | mcts | 2 | 139.217 | 135.889 | 141.930 | 49 | 48 | 345 |
| developed middlegame | minimax | 3 | 39.949 | 38.712 | 40.878 | 106 | 63 | 1577 |
| developed middlegame | mcts | 3 | 280.896 | 272.788 | 287.409 | 73 | 72 | 256 |
| developed middlegame | minimax | 4 | 120.486 | 119.273 | 121.623 | 421 | 150 | 1245 |
| developed middlegame | mcts | 4 | 467.230 | 454.034 | 502.451 | 97 | 96 | 205 |
| tactical position | minimax | 1 | 1.873 | 1.724 | 2.120 | 6 | 5 | 2669 |
| tactical position | mcts | 1 | 32.403 | 31.632 | 33.518 | 25 | 24 | 741 |
| tactical position | minimax | 2 | 11.419 | 11.299 | 11.795 | 31 | 17 | 1489 |
| tactical position | mcts | 2 | 129.826 | 127.181 | 132.559 | 49 | 48 | 370 |
| tactical position | minimax | 3 | 36.361 | 35.253 | 39.197 | 121 | 57 | 1568 |
| tactical position | mcts | 3 | 270.771 | 254.727 | 298.664 | 73 | 72 | 266 |
| tactical position | minimax | 4 | 140.552 | 135.840 | 153.067 | 402 | 166 | 1181 |
| tactical position | mcts | 4 | 438.771 | 413.061 | 488.314 | 96 | 96 | 219 |
