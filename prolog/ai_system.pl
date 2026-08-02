% =============================================================================
% SENTIO — Emotion-Adaptive Chess AI
% Beginner-friendly Prolog knowledge base
% =============================================================================
% Load with:  swipl -s prolog/ai_system.pl
% Then query: ?- help.
% =============================================================================

% ---------------------------------------------------------------------------
% 1. FACTS: What emotion → what strength?
% ---------------------------------------------------------------------------

profile(stressed,    1,  1, 1320).
profile(frustrated,  2,  3, 1320).
profile(calm,        4,  6, 1600).
profile(neutral,     6, 10, 2000).
profile(focused,     8, 15, 2600).
profile(confident,  10, 20, 3190).

% ---------------------------------------------------------------------------
% 2. FACTS: What face → what emotion?
% ---------------------------------------------------------------------------

expression(happy,     confident).
expression(neutral_x, neutral).
expression(sad,       frustrated).
expression(angry,     frustrated).
expression(fearful,   stressed).
expression(surprised, focused).
expression(disgusted, stressed).

% ---------------------------------------------------------------------------
% 3. QUERIES YOU CAN RUN
% ---------------------------------------------------------------------------

% ?- profile(calm, Depth, Skill, Elo).
%   → Depth=4, Skill=6, Elo=1600

% ?- expression(sad, Emotion).
%   → Emotion=frustrated

% ?- engine_for(sad, Depth, Skill, Elo).
%   → Depth=2, Skill=3, Elo=1320

engine_for(Expr, Depth, Skill, Elo) :-
    expression(Expr, Emotion),
    profile(Emotion, Depth, Skill, Elo).

% ?- strongest(Emotion, Elo).
%   → Emotion=confident, Elo=3190

strongest(Emotion, Elo) :-
    profile(Emotion, _Depth, _Skill, Elo),
    \+ (profile(_, _D2, _S2, Elo2), Elo2 > Elo).

% ?- weakest(Emotion, Elo).
%   → Emotion=stressed, Elo=1320 (or Emotion=frustrated, Elo=1320)

weakest(Emotion, Elo) :-
    profile(Emotion, _Depth, _Skill, Elo),
    \+ (profile(_, _D2, _S2, Elo2), Elo2 < Elo).

% ---------------------------------------------------------------------------
% 4. INTERACTIVE HELP
% ---------------------------------------------------------------------------

help :-
    writeln('SENTIO — Emotion-Adaptive Chess AI'),
    writeln(''),
    writeln('Emotions & strength:'),
    forall(profile(E, D, S, El),
           format('  ~w → depth=~d, skill=~d, ELO=~d\n', [E, D, S, El])),
    writeln(''),
    writeln('Face → emotion:'),
    forall(expression(Face, Emo),
           format('  ~w → ~w\n', [Face, Emo])),
    writeln(''),
    writeln('Try these queries:'),
    writeln('  ?- profile(calm, Depth, Skill, Elo).'),
    writeln('  ?- expression(sad, Emotion).'),
    writeln('  ?- engine_for(sad, Depth, Skill, Elo).'),
    writeln('  ?- strongest(Emotion, Elo).'),
    writeln('  ?- weakest(Emotion, Elo).'),
    writeln('').

% =============================================================================