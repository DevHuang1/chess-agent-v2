# Minimax vs. MCTS Search Benchmarks

Generated: 2026-08-15T12:01:33.536Z
Runtime: v22.13.0 linux/x64  
Samples per row: 5; warmups per row: 2

Timing is wall-clock generation time for the local trace builders. Lower average milliseconds is faster; work-units/sec uses evaluated leaves for Minimax and rollout iterations for MCTS.

| Position | Algorithm | Depth | Avg ms | Min ms | Max ms | Nodes | Evaluated / rollouts | Work units/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| opening response | minimax | 1 | 2.680 | 1.787 | 3.997 | 6 | 5 | 1866 |
| opening response | mcts | 1 | 24.841 | 24.332 | 25.255 | 25 | 24 | 966 |
| opening response | minimax | 2 | 7.609 | 7.341 | 8.214 | 31 | 10 | 1314 |
| opening response | mcts | 2 | 90.826 | 86.909 | 93.910 | 49 | 48 | 528 |
| opening response | minimax | 3 | 22.549 | 19.886 | 25.016 | 86 | 44 | 1951 |
| opening response | mcts | 3 | 176.609 | 168.292 | 197.399 | 73 | 72 | 408 |
| opening response | minimax | 4 | 82.385 | 75.423 | 90.267 | 311 | 109 | 1323 |
| opening response | mcts | 4 | 276.120 | 270.327 | 289.020 | 97 | 96 | 348 |
| opening response | minimax | 5 | 295.584 | 285.756 | 307.797 | 1281 | 517 | 1749 |
| opening response | mcts | 5 | 435.257 | 426.831 | 450.000 | 121 | 120 | 276 |
| opening response | minimax | 6 | 1424.299 | 1406.484 | 1444.956 | 5496 | 1946 | 1366 |
| opening response | mcts | 6 | 588.310 | 585.922 | 591.362 | 145 | 144 | 245 |
| developed middlegame | minimax | 1 | 2.700 | 2.179 | 3.876 | 6 | 5 | 1852 |
| developed middlegame | mcts | 1 | 37.699 | 37.339 | 38.691 | 25 | 24 | 637 |
| developed middlegame | minimax | 2 | 9.294 | 9.192 | 9.351 | 31 | 18 | 1937 |
| developed middlegame | mcts | 2 | 131.967 | 131.520 | 132.804 | 49 | 48 | 364 |
| developed middlegame | minimax | 3 | 37.455 | 37.108 | 37.819 | 106 | 63 | 1682 |
| developed middlegame | mcts | 3 | 262.451 | 258.544 | 269.106 | 73 | 72 | 274 |
| developed middlegame | minimax | 4 | 115.609 | 114.180 | 116.878 | 421 | 150 | 1297 |
| developed middlegame | mcts | 4 | 428.773 | 422.737 | 435.516 | 97 | 96 | 224 |
| developed middlegame | minimax | 5 | 546.490 | 542.128 | 552.383 | 1565 | 627 | 1147 |
| developed middlegame | mcts | 5 | 618.674 | 613.512 | 622.499 | 121 | 120 | 194 |
| developed middlegame | minimax | 6 | 1438.833 | 1423.202 | 1470.891 | 5068 | 1646 | 1144 |
| developed middlegame | mcts | 6 | 901.934 | 882.362 | 929.397 | 145 | 144 | 160 |
| tactical position | minimax | 1 | 1.783 | 1.664 | 1.851 | 6 | 5 | 2804 |
| tactical position | mcts | 1 | 30.146 | 29.446 | 32.241 | 25 | 24 | 796 |
| tactical position | minimax | 2 | 11.391 | 10.900 | 11.975 | 31 | 17 | 1492 |
| tactical position | mcts | 2 | 112.352 | 111.379 | 114.360 | 49 | 48 | 427 |
| tactical position | minimax | 3 | 32.983 | 32.401 | 33.302 | 121 | 57 | 1728 |
| tactical position | mcts | 3 | 240.189 | 234.354 | 255.556 | 73 | 72 | 300 |
| tactical position | minimax | 4 | 131.648 | 128.750 | 135.981 | 402 | 166 | 1261 |
| tactical position | mcts | 4 | 414.619 | 390.233 | 460.568 | 96 | 96 | 232 |
| tactical position | minimax | 5 | 375.883 | 372.348 | 381.027 | 1451 | 528 | 1405 |
| tactical position | mcts | 5 | 602.571 | 591.640 | 622.172 | 116 | 120 | 199 |
| tactical position | minimax | 6 | 1437.369 | 1426.920 | 1445.511 | 4584 | 1650 | 1148 |
| tactical position | mcts | 6 | 818.615 | 798.979 | 835.912 | 137 | 144 | 176 |
