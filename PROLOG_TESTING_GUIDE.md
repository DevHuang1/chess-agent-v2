# Testing `prolog/ai_system.pl` in the SENTIO Project

## 1. What I tested

I tested the Prolog knowledge base directly inside `/Users/yuza/chess-agent-v2` using SWI-Prolog 10.0.2. The file loads successfully, and the static facts, emotion-to-engine mapping, strongest/weakest rules, `help/0`, and dynamic chess-advice rules all execute.

One important finding is that the current JavaScript/Next.js source does not contain a reference to `ai_system.pl`, `swipl`, `advice/3`, or `engine_for/4`. Therefore, the Prolog file currently works as a standalone knowledge base, but it is not yet connected to the web application automatically. The commands below test the Prolog layer itself.

## 2. Prerequisites

Open Terminal and run:

```bash
cd /Users/yuza/chess-agent-v2
swipl --version
```

Expected result:

```text
SWI-Prolog version 10.0.2 for fat-darwin
```

If `swipl` is not found, install SWI-Prolog from [swi-prolog.org](https://www.swi-prolog.org/Download.html), then reopen Terminal and repeat the command.

## 3. Load the file interactively

Run:

```bash
cd /Users/yuza/chess-agent-v2
swipl -s prolog/ai_system.pl
```

You should see a Prolog prompt:

```text
?-
```

At this prompt, enter the following queries one at a time. Type `;` to ask for another solution and type `.` to stop searching.

### 3.1 Test a profile fact

```prolog
profile(calm, Depth, Skill, Elo).
```

Expected result:

```text
Depth = 4,
Skill = 6,
Elo = 1600.
```

This confirms that the `profile/4` facts are loaded.

### 3.2 Test expression-to-emotion-to-engine mapping

```prolog
engine_for(sad, Depth, Skill, Elo).
```

Expected result:

```text
Depth = 2,
Skill = 3,
Elo = 1320.
```

The rule follows this chain:

```text
sad -> frustrated -> profile(frustrated, 2, 3, 1320)
```

### 3.3 Test the strongest profile

```prolog
strongest(Emotion, Elo).
```

Expected result:

```text
Emotion = confident,
Elo = 3190.
```

### 3.4 Test all weakest profiles

```prolog
findall(Emotion-Elo, weakest(Emotion, Elo), Results).
```

Expected result:

```text
Results = [stressed-1320, frustrated-1320].
```

Both results are correct because those two profiles have the same lowest ELO.

### 3.5 Test the help command

```prolog
help.
```

This prints the profiles, expression mappings, and example queries.

Exit Prolog with:

```prolog
halt.
```

## 4. Test the chess advice rules with temporary facts

The advice rules depend on dynamic facts such as `turn/1`, `piece/3`, `in_check/1`, and `attacked_by/2`. In the real application, the backend must assert these facts before querying `advice/3`.

For repeatable testing, the project now contains:

```text
tmp_prolog_test.pl
```

Run it with:

```bash
cd /Users/yuza/chess-agent-v2
swipl -q -s tmp_prolog_test.pl
```

The test harness clears old dynamic facts, asserts a fresh set of facts for each scenario, queries `advice/3`, and prints the recommendations.

Expected scenarios include:

| Scenario | Facts being tested | Expected advice |
|---|---|---|
| CHECK | `turn(white)`, `in_check(white)` | Priority 99 safety warning |
| HANGING PIECE | White pawn on e4 attacked by black | Priority 95 tactics warning |
| FREE CAPTURE | Black queen on d5 attacked by white and undefended | Priority 90 tactics opportunity |
| CASTLING | White king on e1, move 6, not castled | Priority 85 castling advice |
| UNDEVELOPED MINOR | White knight on b1, move 5 | Priority 80 development advice |
| EARLY QUEEN | White queen on d5, move 5 | Priority 75 queen warning |
| NO CENTER | White has no piece on d4/d5/e4/e5 | Priority 70 center advice |
| ENDGAME KING | White king on e1, move 30 | Priority 60 king-activation advice |

The test run completed successfully. For example, the CHECK case returned:

```text
[99-safety-'You are in check - resolve the threat before anything else.',70-strategy-'Fight for the center - you have nothing touching d4, d5, e4 or e5.']
```

The extra center advice is expected because the test position intentionally contains no white piece on any center square. The rules are independent, so more than one recommendation can be returned for the same position.

## 5. How the repeatable test harness works

The important part of `tmp_prolog_test.pl` is:

```prolog
retractall(piece(_, _, _)),
retractall(turn(_)),
retractall(move_number(_)),
retractall(castled(_)),
retractall(in_check(_)),
retractall(attacked_by(_, _)),
retractall(defended_by(_, _)),
maplist(assertz, Facts),
findall(P-C-T, advice(P, C, T), Advice).
```

The `retractall/1` calls prevent facts from one scenario leaking into the next scenario. `maplist(assertz, Facts)` adds the scenario facts to the dynamic knowledge base. `findall/3` collects every matching advice result into one list.

To add another scenario, add another call inside `main`, for example:

```prolog
run_case('DEFENDED PIECE', [
    turn(white),
    piece(e4, white, pawn),
    attacked_by(e4, black),
    defended_by(e4, white)
]),
```

This should not produce the hanging-piece warning because the pawn is defended.

## 6. Test from a single command without entering the Prolog prompt

You can test individual predicates directly from Terminal:

```bash
cd /Users/yuza/chess-agent-v2
swipl -q -s prolog/ai_system.pl \
  -g "engine_for(sad,D,S,E),format('D=~w S=~w E=~w~n',[D,S,E]),halt."
```

Expected output:

```text
D=2 S=3 E=1320
```

This style is useful for shell scripts, CI, or a backend process.

## 7. Run the existing JavaScript tests separately

The project’s existing JavaScript test command is:

```bash
cd /Users/yuza/chess-agent-v2
npm test -- --run
```

The run completed with **155 passing tests and 4 failing tests**. The failures are in `lib/lessons.test.ts`, not in the Prolog file. They are caused by an illegal chess lesson move:

```text
Illegal move "Qf8#" in lesson mate-in-2-queen at ply 5
```

This means the Prolog smoke tests pass, while the broader application test suite currently has an independent lesson-data issue that should be fixed separately.

## 8. Current integration status

At the moment, the project has the Prolog file and it can be tested successfully, but the application source does not yet invoke SWI-Prolog. To integrate it, the backend would need to do the following for each board position:

1. Start or reuse a SWI-Prolog process.
2. Load `prolog/ai_system.pl`.
3. Clear old dynamic facts with `retractall/1`.
4. Assert the current board facts such as `piece/3`, `turn/1`, and attack/defence facts.
5. Query `advice(Priority, Category, Text)`.
6. Return the collected results to the Next.js frontend.
7. Sort or preserve results by priority before displaying them in the Logician panel.

Do not pass untrusted user text directly into a Prolog query. Board facts should be converted from validated chess data into a controlled query format.

## 9. Recommended test order

Use this order when developing:

1. Run `swipl --version`.
2. Run the static profile queries.
3. Run `swipl -q -s tmp_prolog_test.pl`.
4. Add or modify one scenario at a time in the harness.
5. Run `npm test -- --run` to verify that application behavior has not regressed.
6. Only after the standalone tests pass, connect the backend to Prolog.

## 10. Cleanup

The repeatable test file is useful and can be kept in the repository. If it was intended only as a temporary local test, remove it with:

```bash
cd /Users/yuza/chess-agent-v2
rm tmp_prolog_test.pl
```

The original Prolog file is located at:

```text
/Users/yuza/chess-agent-v2/prolog/ai_system.pl
```
