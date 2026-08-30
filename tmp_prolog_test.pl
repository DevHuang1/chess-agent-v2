:- consult('prolog/ai_system.pl').

run_case(Name, Facts) :-
    retractall(piece(_, _, _)), retractall(turn(_)), retractall(move_number(_)),
    retractall(castled(_)), retractall(in_check(_)),
    retractall(attacked_by(_, _)), retractall(defended_by(_, _)),
    maplist(assertz, Facts),
    findall(P-C-T, advice(P, C, T), Advice),
    format('~w~n  ~q~n', [Name, Advice]).

main :-
    run_case('CHECK', [turn(white), in_check(white)]),
    run_case('HANGING PIECE', [turn(white), piece(e4,white,pawn), attacked_by(e4,black)]),
    run_case('FREE CAPTURE', [turn(white), piece(d5,black,queen), attacked_by(d5,white)]),
    run_case('CASTLING', [turn(white), piece(e1,white,king), move_number(6)]),
    run_case('UNDEVELOPED MINOR', [turn(white), piece(b1,white,knight), move_number(5)]),
    run_case('EARLY QUEEN', [turn(white), piece(d5,white,queen), move_number(5)]),
    run_case('NO CENTER', [turn(white), move_number(10)]),
    run_case('ENDGAME KING', [turn(white), piece(e1,white,king), move_number(30)]),
    halt.

:- initialization(main).
