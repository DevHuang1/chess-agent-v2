# 🎙️ Burmese Voice Moves — Phrase Cheat-Sheet

A quick reference for speaking chess moves in Burmese to **Sentio's Voice Move** feature.
This lists the exact phrases the app's recognizer (`lib/speechParser.ts`) and the
Speech tab are built to understand.

---

## How to form a move

The app listens for:

```
<piece name in Burmese>  <file letter in Burmese> <rank number>  (optional connector)
```

The word order matches English (e.g. "knight f3"). Connectors like `ကို` (to),
`ကနေ` (from) and `ဖမ်း` (capture/takes) are optional — the parser strips them.

## Pieces — Burmese names the parser understands

| Piece  | Burmese                         | Sounds like    |
| ------ | ------------------------------- | -------------- |
| Pawn   | `နိုင်` / `စစ်သား`              | nain / sit-tha |
| Knight | `မြင်း`                         | myin           |
| Bishop | `ဆင်`                           | sin            |
| Rook   | `ကျီ` / `လှေ`                   | chi / hle      |
| Queen  | `မိဖုရား` / `မိဗျား` / `ဘုရင်မ` | mee-phu-ya     |
| King   | `ဘုရင်`                         | ba-yin         |

## Files — Burmese letter sounds the parser accepts

| File | Burmese                | Sounds like |
| ---- | ---------------------- | ----------- |
| a    | `အေ`                   | ay          |
| b    | `ဘီ`                   | bee         |
| c    | `စီ`                   | see         |
| d    | `ဒီ`                   | dee         |
| e    | `အီး` / `အီ` / `၏`     | ee          |
| f    | `အာပ်` / `အဖ်` / `အာ့` | eff         |
| g    | `ဂျီ`                  | jee         |
| h    | `အိတ်`                 | etch        |

## Ranks — numbers

The recognizer accepts both **Burmese numerals** (`တစ်`=1 … `ရှစ်`=8) and the
**English number words** ("five", "three", …). Both are supported, but the model
was tuned especially on the Burmaised English letter-sound + English number form
(e.g. `အာ့ သုံး` = "eff three" = **f3**):

| Square | Say in Burmese | Sounds like |
| ------ | -------------- | ----------- |
| **f3** | `အာ့ သုံး`     | eff three   |
| **e4** | `အီး လေး`      | ee four     |
| **d5** | `ဒီ ငါး`       | dee five    |

> The Whisper model often transcribes English ranks phonetically — "three" →
> `သူတွေး` / `သရီး`, "four" → `ဖိုး`, "five" → `ဖိုက်` — and the parser
> understands those too, so imperfect spelling still resolves.

## Example commands

| What you want     | Say in Burmese    | Notes                |
| ----------------- | ----------------- | -------------------- |
| Knight to f3      | `မြင်း f3 ကို`    | the classic example  |
| Pawn to e4        | `နိုင် e4 ကို`    | the classic example  |
| King e1 to e2     | `ဘုရင် e1 ကနေ e2` | from → to with `ကနေ` |
| Queen captures d5 | `မိဖုရား d5 ဖမ်း` | capture with `ဖမ်း`  |
| Castle kingside   | `O-O`             | say "O O"            |
| Bishop to c4      | `ဆင် c4 ကို`      |                      |
| Rook takes h5     | `ကျီ h5 ဖမ်း`     |                      |

These five phrases match the app's built-in Speech-tab examples
(`SPEECH_EXAMPLES.my`) and are the reference phrases the recognizer is designed
around:

- `မြင်း f3 ကို` — knight to f3
- `နိုင် e4 ကို` — pawn to e4
- `ဘုရင် e1 ကနေ e2` — king e1 to e2
- `မိဖုရား d5 ဖမ်း` — queen takes d5
- `O-O` — castle kingside

## Tips for the best recognition

- Use the **file-letter sound + English rank** form (`အာ့ သုံး` = f3) — the most
  reliable combination the recognizer and Whisper model were tuned on.
- Say the **piece first, then the square**, matching the English prompt order.
- Keep connectors minimal — `မြင်း f3` alone usually works, since the parser
  strips fillers like `ကို`, `ကနေ`, `မှာ`.
