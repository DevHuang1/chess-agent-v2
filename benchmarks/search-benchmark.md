# Minimax vs. MCTS Search Benchmarks

Generated: 2026-08-15T12:13:01.644Z
Runtime: v22.13.0 linux/x64  
Samples per row: 5; warmups per row: 2

Timing is wall-clock generation time for the local trace builders. Lower average milliseconds is faster; work-units/sec uses evaluated leaves for Minimax and rollout iterations for MCTS.

| Position | Algorithm | Depth | Avg ms | Min ms | Max ms | Nodes | Evaluated / rollouts | Work units/s | Cutoffs | TT hits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| opening response | minimax | 1 | 2.824 | 1.789 | 3.896 | 6 | 5 | 1770 | 0 | 0 |
| opening response | mcts | 1 | 24.535 | 23.809 | 25.407 | 25 | 24 | 978 | 0 | 0 |
| opening response | minimax | 2 | 8.066 | 7.658 | 8.739 | 31 | 14 | 1736 | 4 | 0 |
| opening response | mcts | 2 | 84.002 | 80.535 | 87.948 | 49 | 48 | 571 | 0 | 0 |
| opening response | minimax | 3 | 21.952 | 21.809 | 22.175 | 96 | 50 | 2278 | 8 | 0 |
| opening response | mcts | 3 | 164.634 | 162.855 | 167.475 | 73 | 72 | 437 | 0 | 0 |
| opening response | minimax | 4 | 76.069 | 74.101 | 77.594 | 296 | 122 | 1604 | 32 | 6 |
| opening response | mcts | 4 | 268.091 | 265.795 | 273.493 | 97 | 96 | 358 | 0 | 0 |
| opening response | minimax | 5 | 251.706 | 246.512 | 261.827 | 1146 | 420 | 1669 | 129 | 30 |
| opening response | mcts | 5 | 414.864 | 409.185 | 424.202 | 121 | 120 | 289 | 0 | 0 |
| opening response | minimax | 6 | 837.813 | 823.928 | 866.780 | 3438 | 1103 | 1317 | 423 | 82 |
| opening response | mcts | 6 | 578.709 | 567.038 | 590.167 | 145 | 144 | 249 | 0 | 0 |
| developed middlegame | minimax | 1 | 2.652 | 2.141 | 4.051 | 6 | 5 | 1885 | 0 | 0 |
| developed middlegame | mcts | 1 | 37.353 | 37.028 | 37.695 | 25 | 24 | 643 | 0 | 0 |
| developed middlegame | minimax | 2 | 9.172 | 8.943 | 9.473 | 31 | 17 | 1853 | 2 | 0 |
| developed middlegame | mcts | 2 | 132.682 | 129.736 | 140.991 | 49 | 48 | 362 | 0 | 0 |
| developed middlegame | minimax | 3 | 38.270 | 37.907 | 38.532 | 106 | 54 | 1411 | 9 | 0 |
| developed middlegame | mcts | 3 | 265.401 | 257.226 | 274.242 | 73 | 72 | 271 | 0 | 0 |
| developed middlegame | minimax | 4 | 105.022 | 98.167 | 127.727 | 361 | 121 | 1152 | 43 | 6 |
| developed middlegame | mcts | 4 | 436.006 | 416.343 | 456.547 | 97 | 96 | 220 | 0 | 0 |
| developed middlegame | minimax | 5 | 481.105 | 478.290 | 484.215 | 1419 | 545 | 1133 | 162 | 7 |
| developed middlegame | mcts | 5 | 602.627 | 592.913 | 626.469 | 121 | 120 | 199 | 0 | 0 |
| developed middlegame | minimax | 6 | 872.190 | 852.954 | 893.558 | 2947 | 899 | 1031 | 381 | 59 |
| developed middlegame | mcts | 6 | 900.359 | 871.088 | 963.154 | 145 | 144 | 160 | 0 | 0 |
| tactical position | minimax | 1 | 1.871 | 1.750 | 2.138 | 6 | 5 | 2673 | 0 | 0 |
| tactical position | mcts | 1 | 31.516 | 29.336 | 36.913 | 25 | 24 | 762 | 0 | 0 |
| tactical position | minimax | 2 | 10.765 | 10.688 | 10.851 | 31 | 17 | 1579 | 2 | 0 |
| tactical position | mcts | 2 | 115.787 | 114.488 | 116.447 | 49 | 48 | 415 | 0 | 0 |
| tactical position | minimax | 3 | 35.677 | 34.551 | 37.546 | 126 | 61 | 1710 | 12 | 0 |
| tactical position | mcts | 3 | 234.219 | 232.040 | 239.910 | 73 | 72 | 307 | 0 | 0 |
| tactical position | minimax | 4 | 140.667 | 137.133 | 142.173 | 432 | 184 | 1308 | 45 | 0 |
| tactical position | mcts | 4 | 370.957 | 367.094 | 374.277 | 96 | 96 | 259 | 0 | 0 |
| tactical position | minimax | 5 | 352.773 | 348.067 | 361.740 | 1370 | 473 | 1341 | 172 | 15 |
| tactical position | mcts | 5 | 620.397 | 593.640 | 641.865 | 116 | 120 | 193 | 0 | 0 |
| tactical position | minimax | 6 | 1076.191 | 1047.859 | 1111.566 | 3424 | 1172 | 1089 | 427 | 27 |
| tactical position | mcts | 6 | 830.208 | 772.839 | 893.340 | 137 | 144 | 173 | 0 | 0 |
