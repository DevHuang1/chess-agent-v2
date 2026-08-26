% =============================================================================
% SENTIO — Emotion-Adaptive Chess AI
% Beginner-friendly Prolog knowledge base
% =============================================================================
% Load with:  swipl -s prolog/ai_system.pl
% Then query: ?- help.
%
% Part 1 (static): emotion → engine-strength profiles.
% Part 2 (dynamic): chess-position reasoning. The Python backend asserts
% position facts per request (piece/3, turn/1, ...) and queries advice/3 to
% get prioritized, human-readable recommendations for the Logician panel.
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

engine_for(Expr, Depth, Skill, Elo) :-
    expression(Expr, Emotion),
    profile(Emotion, Depth, Skill, Elo).

strongest(Emotion, Elo) :-
    profile(Emotion, _Depth, _Skill, Elo),
    \+ (profile(_, _D2, _S2, Elo2), Elo2 > Elo).

weakest(Emotion, Elo) :-
    profile(Emotion, _Depth, _Skill, Elo),
    \+ (profile(_, _D2, _S2, Elo2), Elo2 < Elo).

% =============================================================================
% PART 2 — CHESS POSITION REASONING (Logician panel)
% =============================================================================
% The backend asserts these DYNAMIC FACTS before each query:
%   piece(Square, Color, Type)   e.g. piece(e4, white, pawn)
%   turn(Color)                  side to move ("you")
%   move_number(N)               fullmove number
%   castled(Color)               present only if that color has castled
%   in_check(Color)              present only if that color is in check
%   attacked_by(Square, Color)   Square is attacked by Color's pieces
%   defended_by(Square, Color)   an own piece on Square is defended by Color
% =============================================================================

:- dynamic(piece/3).
:- dynamic(turn/1).
:- dynamic(move_number/1).
:- dynamic(castled/1).
:- dynamic(in_check/1).
:- dynamic(attacked_by/2).
:- dynamic(defended_by/2).

other(white, black).
other(black, white).

center_square(d4).
center_square(d5).
center_square(e4).
center_square(e5).

home_minor_square(b1). home_minor_square(g1).
home_minor_square(c1). home_minor_square(f1).
home_minor_square(b8). home_minor_square(g8).
home_minor_square(c8). home_minor_square(f8).

back_rank_square(a1). back_rank_square(b1). back_rank_square(c1).
back_rank_square(d1). back_rank_square(e1). back_rank_square(f1).
back_rank_square(g1). back_rank_square(h1).
back_rank_square(a8). back_rank_square(b8). back_rank_square(c8).
back_rank_square(d8). back_rank_square(e8). back_rank_square(f8).
back_rank_square(g8). back_rank_square(h8).

% --- Derived concepts -------------------------------------------------------

% One of MY pieces that is attacked and has no defender: it is hanging.
hanging_mine(Square, Type) :-
    turn(Me),
    other(Me, Them),
    piece(Square, Me, Type),
    Type \= king,
    attacked_by(Square, Them),
    \+ defended_by(Square, Me).

% An ENEMY piece I attack that has no defender: free material.
free_capture(Square, TheirType) :-
    turn(Me),
    other(Me, Them),
    piece(Square, Them, TheirType),
    TheirType \= king,
    attacked_by(Square, Me),
    \+ defended_by(Square, Them).

% A minor piece still sitting on its starting square.
undeveloped_minor(Square, Type) :-
    turn(Me),
    piece(Square, Me, Type),
    member(Type, [knight, bishop]),
    home_minor_square(Square).

% I should castle: king unmoved, past the first few moves.
needs_castling :-
    turn(white),
    \+ castled(white),
    piece(e1, white, king),
    move_number(N),
    N < 12.
needs_castling :-
    turn(black),
    \+ castled(black),
    piece(e8, black, king),
    move_number(N),
    N < 12.

% My queen has left its home area very early.
early_queen_sortie :-
    turn(Me),
    move_number(N),
    N < 8,
    piece(Square, Me, queen),
    \+ member(Square, [d1, e1, d8, e8]).

% No friendly piece OR pawn occupies any central square.
no_center_presence :-
    turn(Me),
    \+ (center_square(S), piece(S, Me, _)).

% Endgame: king still parked on its back rank late in the game.
sleepy_endgame_king :-
    turn(Me),
    move_number(N),
    N >= 25,
    piece(Square, Me, king),
    back_rank_square(Square).

% --- ADVICE RULES -----------------------------------------------------------
% advice(Priority, Category, Text) — higher Priority is shown first.

advice(99, safety, 'You are in check - resolve the threat before anything else.') :-
    turn(Me),
    in_check(Me).

advice(95, tactics, Text) :-
    hanging_mine(Square, Type),
    format(atom(Text), 'Your ~w on ~w is attacked and undefended - defend it or move it.', [Type, Square]).

advice(90, tactics, Text) :-
    free_capture(Square, TheirType),
    format(atom(Text), 'Free material: the enemy ~w on ~w is undefended.', [TheirType, Square]).

advice(85, opening, 'Castle your king to safety before starting an attack.') :-
    needs_castling.

advice(80, opening, Text) :-
    undeveloped_minor(Square, Type),
    move_number(N),
    N < 12,
    format(atom(Text), 'Develop your ~w on ~w - minor pieces belong in the game early.', [Type, Square]).

advice(75, opening, 'Your queen is out very early - bring it back before it gets harassed.') :-
    early_queen_sortie.

advice(70, strategy, 'Fight for the center - you have nothing touching d4, d5, e4 or e5.') :-
    no_center_presence.

advice(60, endgame, 'Activate your king - in the endgame it is a fighting piece.') :-
    sleepy_endgame_king.

% ---------------------------------------------------------------------------
% INTERACTIVE HELP
% ---------------------------------------------------------------------------

help :-
    writeln('SENTIO - Emotion-Adaptive Chess AI'),
    writeln(''),
    writeln('Emotions & strength:'),
    forall(profile(E, D, S, El),
           format('  ~w -> depth=~d, skill=~d, ELO=~d\n', [E, D, S, El])),
    writeln(''),
    writeln('Face -> emotion:'),
    forall(expression(Face, Emo),
           format('  ~w -> ~w\n', [Face, Emo])),
    writeln(''),
    writeln('Position reasoning (after asserting facts):'),
    writeln('  ?- advice(Priority, Category, Text).'),
    writeln(''),
    writeln('Try these queries:'),
    writeln('  ?- profile(calm, Depth, Skill, Elo).'),
    writeln('  ?- engine_for(sad, Depth, Skill, Elo).'),
    writeln('  ?- strongest(Emotion, Elo).'),
    writeln('  ?- weakest(Emotion, Elo).'),
    writeln('').

% =============================================================================