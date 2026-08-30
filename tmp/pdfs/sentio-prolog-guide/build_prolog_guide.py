from pathlib import Path
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


OUT = Path("/Users/yuza/chess-agent-v2/output/pdf/Sentio_Prolog_Presenter_Review_Guide.pdf")
SCREENSHOT = Path("/Users/yuza/chess-agent-v2/.presentation-build/assets/sentio-logician.png")

W, H = 960, 540

BG = HexColor("#242830")
PANEL = HexColor("#303640")
PANEL_2 = HexColor("#39404A")
CREAM = HexColor("#FFF7E8")
MUTED = HexColor("#C7CBD0")
FAINT = HexColor("#8E949C")
ORANGE = HexColor("#FF8A3D")
YELLOW = HexColor("#FFC24B")
CORAL = HexColor("#F16B5B")
BLUE = HexColor("#8FB5D9")
GREEN = HexColor("#89C997")
BLACK = HexColor("#15181D")


def wrap(text, font, size, max_width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else current + " " + word
        if stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def text_block(c, text, x, y, width, size=18, color=CREAM, font="Helvetica", leading=None, max_lines=None):
    leading = leading or size * 1.28
    lines = wrap(text, font, size, width)
    if max_lines:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(color)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def bullet_list(c, items, x, y, width, size=16, color=CREAM, accent=ORANGE, gap=14, leading=None):
    leading = leading or size * 1.3
    cursor = y
    for item in items:
        c.setFillColor(accent)
        c.circle(x + 4, cursor + 4, 3.5, fill=1, stroke=0)
        cursor = text_block(c, item, x + 18, cursor, width - 18, size=size, color=color, leading=leading)
        cursor -= gap
    return cursor


def page_base(c, number, kicker, title, subtitle=None):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, H - 7, W, 7, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(46, H - 43, kicker.upper())
    c.setFillColor(CREAM)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(46, H - 80, title)
    if subtitle:
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 13)
        c.drawString(47, H - 101, subtitle)
    c.setStrokeColor(HexColor("#4B515B"))
    c.line(46, 33, W - 46, 33)
    c.setFillColor(FAINT)
    c.setFont("Helvetica", 8.5)
    c.drawString(46, 18, "Sentio Prolog Presenter Review Guide")
    c.drawRightString(W - 46, 18, f"{number:02d}")


def panel(c, x, y, w, h, fill=PANEL, radius=14, stroke=None):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1 if stroke else 0)


def pill(c, text, x, y, fill=ORANGE, text_color=BLACK, width=None):
    c.setFont("Helvetica-Bold", 10)
    pad = 10
    w = width or stringWidth(text, "Helvetica-Bold", 10) + pad * 2
    c.setFillColor(fill)
    c.roundRect(x, y, w, 23, 11, fill=1, stroke=0)
    c.setFillColor(text_color)
    c.drawCentredString(x + w / 2, y + 7, text)
    return w


def arrow(c, x1, y1, x2, y2, color=ORANGE):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(3)
    c.line(x1, y1, x2, y2)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    size = 9
    p1 = (x2, y2)
    p2 = (x2 - size * math.cos(angle - 0.55), y2 - size * math.sin(angle - 0.55))
    p3 = (x2 - size * math.cos(angle + 0.55), y2 - size * math.sin(angle + 0.55))
    path = c.beginPath()
    path.moveTo(*p1)
    path.lineTo(*p2)
    path.lineTo(*p3)
    path.close()
    c.drawPath(path, fill=1, stroke=0)


def draw_contained_image(c, path, x, y, w, h):
    img = ImageReader(str(path))
    iw, ih = img.getSize()
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, width=dw, height=dh, mask="auto")


def mono(c, lines, x, y, w, size=12, color=CREAM, leading=17):
    c.setFont("Courier", size)
    c.setFillColor(color)
    cursor = y
    for line in lines:
        if stringWidth(line, "Courier", size) > w:
            line = line[: int(w / (size * 0.61)) - 1]
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def page_1(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, H - 10, W, 10, fill=1, stroke=0)
    c.setFillColor(PANEL)
    c.circle(820, 388, 128, fill=1, stroke=0)
    c.setFillColor(YELLOW)
    c.circle(825, 392, 92, fill=1, stroke=0)
    c.setFillColor(BG)
    c.circle(825, 392, 58, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(54, 469, "SENTIO - PRESENTER REVIEW")
    c.setFillColor(CREAM)
    c.setFont("Helvetica-Bold", 43)
    c.drawString(54, 392, "How Prolog Works")
    c.drawString(54, 343, "in This Project")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 18)
    c.drawString(57, 302, "A clear, truthful guide for explaining The Logician")
    panel(c, 54, 126, 592, 118, fill=PANEL_2)
    pill(c, "ONE-SENTENCE VERSION", 74, 199, fill=ORANGE)
    text_block(
        c,
        "Prolog reads facts about the current chess position, applies human-readable rules, and returns prioritized advice - while Stockfish still chooses moves.",
        74,
        181,
        548,
        size=18,
        color=CREAM,
        font="Helvetica-Bold",
        leading=25,
    )
    c.setFillColor(FAINT)
    c.setFont("Helvetica", 10)
    c.drawString(54, 55, "Built from the current Sentio source: prolog/ai_system.pl, backend/main.py, app/api/prolog/route.ts")
    c.setFillColor(FAINT)
    c.drawRightString(W - 54, 55, "Review before presenting")
    c.showPage()


def page_2(c):
    page_base(c, 2, "The 30-second answer", "What Prolog does in Sentio", "Use this slide when someone asks, 'Why is Prolog here?'")
    cards = [
        ("1", "READS", "It receives facts describing the current board: pieces, turn, checks, attacks, defenders, move number, and castling state.", BLUE),
        ("2", "REASONS", "It applies symbolic chess rules such as: in check, hanging piece, free capture, develop a minor piece, castle, or fight for the center.", ORANGE),
        ("3", "EXPLAINS", "It returns up to six recommendations, sorted by priority, for the Logician panel to display in plain language.", GREEN),
    ]
    x = 46
    for num, label, body, accent in cards:
        panel(c, x, 171, 272, 230, fill=PANEL)
        c.setFillColor(accent)
        c.circle(x + 38, 359, 19, fill=1, stroke=0)
        c.setFillColor(BLACK)
        c.setFont("Helvetica-Bold", 15)
        c.drawCentredString(x + 38, 354, num)
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 66, 351, label)
        text_block(c, body, x + 24, 317, 224, size=15, color=CREAM, leading=21)
        x += 296
    panel(c, 46, 62, 864, 78, fill=HexColor("#412F2D"), stroke=CORAL)
    pill(c, "IMPORTANT", 66, 101, fill=CORAL, text_color=CREAM)
    c.setFillColor(CREAM)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(173, 108, "Prolog does not calculate the best move, move pieces, or run the voice coach.")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(66, 78, "It is an explainable reasoning layer beside Stockfish, not a replacement for Stockfish.")
    c.showPage()


def page_3(c):
    page_base(c, 3, "Architecture", "Where Prolog sits in the live system", "The Logician path is separate from move generation and voice coaching.")
    y = 263
    boxes = [
        (46, 135, "Browser UI", "LogicianPanel sends the current FEN", BLUE),
        (225, 135, "Next.js proxy", "POST /api/prolog", YELLOW),
        (404, 135, "Python backend", "POST /api/prolog-advice", ORANGE),
        (583, 135, "SWI-Prolog", "Queries advice(P,C,T)", CORAL),
        (762, 148, "UI result", "Top six advice cards", GREEN),
    ]
    for x, bw, title, body, accent in boxes:
        panel(c, x, y - 57, bw, 114, fill=PANEL)
        c.setFillColor(accent)
        c.rect(x, y + 49, bw, 8, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(x + bw / 2, y + 20, title)
        for i, line in enumerate(wrap(body, "Helvetica", 10.5, bw - 20)):
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 10.5)
            c.drawCentredString(x + bw / 2, y - 3 - i * 15, line)
    for x1, x2 in [(181, 225), (360, 404), (539, 583), (718, 762)]:
        arrow(c, x1 + 4, y, x2 - 6, y, color=ORANGE)
    panel(c, 46, 67, 404, 98, fill=PANEL_2)
    pill(c, "STOCKFISH PATH", 66, 126, fill=YELLOW)
    text_block(c, "Stockfish searches legal moves and produces the engine reply. It does not depend on Prolog.", 66, 103, 360, size=13.5, color=CREAM, leading=18)
    panel(c, 474, 67, 436, 98, fill=PANEL_2)
    pill(c, "VOICE COACH PATH", 494, 126, fill=BLUE)
    text_block(c, "Transcription, coach text, and speech use their own API routes. Prolog is not part of the runtime voice-coaching service.", 494, 103, 392, size=13.5, color=CREAM, leading=18)
    c.showPage()


def page_4(c):
    page_base(c, 4, "Runtime flow", "From FEN to prioritized advice", "This is the exact request path implemented in the current code.")
    steps = [
        ("01", "Send FEN", "The active Logician tab waits 350 ms, then posts the board FEN to /api/prolog."),
        ("02", "Validate", "The Next.js route validates the body and forwards the FEN to the Python backend."),
        ("03", "Parse board", "python-chess builds a Board object and derives pieces, side to move, check, attacks, and defenders."),
        ("04", "Refresh facts", "The backend retracts old dynamic facts, then asserts facts for this one position."),
        ("05", "Query rules", "SWI-Prolog evaluates advice(P, C, T), with a maximum of 24 raw solutions."),
        ("06", "Rank and show", "Python sorts by priority, returns the top six, and the UI renders category-labelled cards."),
    ]
    positions = [(46, 288), (344, 288), (642, 288), (46, 107), (344, 107), (642, 107)]
    for (num, title, body), (x, y) in zip(steps, positions):
        panel(c, x, y, 268, 143, fill=PANEL)
        c.setFillColor(ORANGE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 20, y + 112, num)
        c.setFillColor(CREAM)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(x + 57, y + 109, title)
        text_block(c, body, x + 20, y + 79, 228, size=12.5, color=MUTED, leading=17)
    c.showPage()


def page_5(c):
    page_base(c, 5, "Dynamic facts", "What the backend asserts into Prolog", "Each request replaces the previous position facts before querying the rules.")
    rows = [
        ("piece/3", "A piece, its color, and type", "piece(e4, white, pawn)"),
        ("turn/1", "The side to move", "turn(white)"),
        ("move_number/1", "The FEN fullmove number", "move_number(7)"),
        ("castled/1", "King is on c-file or g-file after castling", "castled(white)"),
        ("in_check/1", "Side to move is currently in check", "in_check(white)"),
        ("attacked_by/2", "A square is attacked by one color", "attacked_by(f3, black)"),
        ("defended_by/2", "An occupied square has a same-color defender", "defended_by(f3, white)"),
    ]
    x0, y0 = 46, 389
    widths = [152, 338, 374]
    headers = ["FACT", "MEANING", "EXAMPLE"]
    c.setFillColor(ORANGE)
    c.rect(x0, y0, sum(widths), 35, fill=1, stroke=0)
    x = x0
    for head, width in zip(headers, widths):
        c.setFillColor(BLACK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 12, y0 + 12, head)
        x += width
    row_h = 40
    for i, (fact, meaning, example) in enumerate(rows):
        y = y0 - (i + 1) * row_h
        c.setFillColor(PANEL if i % 2 == 0 else PANEL_2)
        c.rect(x0, y, sum(widths), row_h, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.setFont("Courier-Bold", 11)
        c.drawString(x0 + 12, y + 15, fact)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 11)
        c.drawString(x0 + widths[0] + 12, y + 15, meaning)
        c.setFillColor(BLUE)
        c.setFont("Courier", 10.5)
        c.drawString(x0 + widths[0] + widths[1] + 12, y + 15, example)
    panel(c, 46, 61, 864, 34, fill=HexColor("#40382A"))
    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(60, 73, "Presenter note:")
    c.setFillColor(CREAM)
    c.setFont("Helvetica", 11)
    c.drawString(148, 73, "These are temporary, current-position facts - not a permanent game database.")
    c.showPage()


def page_6(c):
    page_base(c, 6, "Rule base", "How the rules choose what appears first", "Higher priority advice is shown before lower priority advice.")
    rules = [
        (99, "SAFETY", "Side to move is in check", CORAL),
        (95, "TACTICS", "Own piece is attacked and undefended", ORANGE),
        (90, "TACTICS", "Enemy piece is attacked and undefended", ORANGE),
        (85, "OPENING", "King should castle before move 12", BLUE),
        (80, "OPENING", "Minor piece remains on its home square", BLUE),
        (75, "OPENING", "Queen moved out very early", BLUE),
        (70, "STRATEGY", "No friendly piece occupies the four center squares", GREEN),
        (60, "ENDGAME", "King remains on the back rank from move 25", YELLOW),
    ]
    start_y = 382
    for i, (priority, category, trigger, accent) in enumerate(rules):
        y = start_y - i * 38
        panel(c, 46, y, 864, 34, fill=PANEL if i % 2 == 0 else PANEL_2, radius=8)
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 15)
        c.drawCentredString(81, y + 10, str(priority))
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(119, y + 12, category)
        c.setFillColor(CREAM)
        c.setFont("Helvetica", 12)
        c.drawString(224, y + 11, trigger)
    panel(c, 46, 55, 864, 47, fill=HexColor("#40382A"))
    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(61, 75, "Why priorities matter:")
    c.setFillColor(CREAM)
    c.setFont("Helvetica", 11)
    c.drawString(177, 75, "Immediate danger outranks general opening or strategic advice.")
    c.showPage()


def page_7(c):
    page_base(c, 7, "Worked example", "How one hanging knight becomes advice", "A simple rule trace you can explain without showing the entire codebase.")
    panel(c, 46, 121, 338, 297, fill=PANEL)
    pill(c, "INPUT FACTS", 66, 375, fill=BLUE)
    mono(c, [
        "turn(white).",
        "piece(f3, white, knight).",
        "attacked_by(f3, black).",
        "% no defended_by(f3, white)",
    ], 66, 338, 298, size=13, leading=25)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(66, 188, "The absence of a defender is meaningful.")
    panel(c, 412, 257, 222, 161, fill=PANEL_2)
    pill(c, "DERIVED RULE", 432, 375, fill=ORANGE)
    mono(c, ["hanging_mine(", "  f3, knight", ")."], 432, 336, 182, size=14, color=CREAM, leading=25)
    panel(c, 662, 121, 248, 297, fill=PANEL)
    pill(c, "OUTPUT", 682, 375, fill=GREEN)
    c.setFillColor(ORANGE)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(682, 333, "PRIORITY 95 - TACTICS")
    text_block(c, "Your knight on f3 is attacked and undefended - defend it or move it.", 682, 298, 208, size=17, color=CREAM, font="Helvetica-Bold", leading=23)
    arrow(c, 385, 270, 408, 270, color=ORANGE)
    arrow(c, 635, 270, 658, 270, color=ORANGE)
    panel(c, 412, 121, 222, 108, fill=HexColor("#40382A"))
    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(432, 197, "The rule checks:")
    bullet_list(c, ["It is my piece", "It is attacked", "It is not defended", "It is not a king"], 432, 175, 182, size=10.5, color=CREAM, gap=3, leading=13)
    c.showPage()


def page_8(c):
    page_base(c, 8, "Role separation", "Stockfish vs Prolog vs the voice coach", "Three AI approaches, each responsible for a different job.")
    cols = [
        (46, "STOCKFISH", YELLOW, "Search AI", ["Calculates strong moves", "Uses numeric evaluation and search", "Controls the engine reply", "Best at: move quality"]),
        (340, "PROLOG", ORANGE, "Symbolic AI", ["Applies hand-written chess rules", "Returns traceable recommendations", "Feeds The Logician panel", "Best at: explainability"]),
        (634, "VOICE COACH", BLUE, "Language AI", ["Answers player questions", "Produces natural-language guidance", "Uses separate transcribe/coach/TTS routes", "Best at: conversation"]),
    ]
    for x, title, accent, kind, items in cols:
        panel(c, x, 93, 276, 325, fill=PANEL)
        c.setFillColor(accent)
        c.rect(x, 408, 276, 10, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(x + 22, 369, title)
        pill(c, kind, x + 22, 326, fill=accent, text_color=BLACK)
        bullet_list(c, items, x + 22, 286, 232, size=13, color=CREAM, accent=accent, gap=12, leading=17)
    panel(c, 46, 55, 864, 27, fill=HexColor("#412F2D"))
    c.setFillColor(CREAM)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(478, 64, "Best presentation phrase: Stockfish moves, Prolog explains, and the voice coach converses.")
    c.showPage()


def page_9(c):
    page_base(c, 9, "Honest boundaries", "Limitations and fallback behavior", "These points protect you from overclaiming during questions.")
    panel(c, 46, 107, 416, 311, fill=PANEL)
    pill(c, "SAFE TO SAY", 66, 375, fill=GREEN)
    bullet_list(c, [
        "Prolog explains selected chess principles from the current board state.",
        "The advice is deterministic and easy to trace back to a rule.",
        "The Logician is optional; the rest of Sentio still works if it is unavailable.",
        "The rule set can be extended with more tactical and strategic concepts.",
    ], 66, 337, 376, size=14, color=CREAM, accent=GREEN, gap=14, leading=19)
    panel(c, 494, 107, 416, 311, fill=HexColor("#3B2D2D"))
    pill(c, "DO NOT CLAIM", 514, 375, fill=CORAL, text_color=CREAM)
    bullet_list(c, [
        "Prolog calculates the best chess move.",
        "Prolog controls piece movement or game rules.",
        "Prolog powers every AI feature in Sentio.",
        "Prolog is part of the runtime voice coach.",
    ], 514, 337, 376, size=14, color=CREAM, accent=CORAL, gap=19, leading=20)
    panel(c, 46, 56, 864, 36, fill=PANEL_2)
    c.setFillColor(YELLOW)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(61, 70, "Fallback:")
    c.setFillColor(CREAM)
    c.setFont("Helvetica", 11)
    c.drawString(113, 70, "Missing SWI-Prolog, pyswip, or python-chess returns available=false; the UI shows a setup hint.")
    c.showPage()


def page_10(c):
    page_base(c, 10, "Presentation guide", "A 60-second talk track + likely questions", "Practice the left side once, then use the answers on the right for Q&A.")
    panel(c, 46, 92, 420, 326, fill=PANEL)
    pill(c, "SAY THIS", 66, 375, fill=ORANGE)
    talk = (
        "Sentio uses Prolog for The Logician, its explainable chess-advice panel. "
        "Whenever the board changes, the panel sends the current FEN through our Next.js API to the Python backend. "
        "The backend converts that position into facts - such as which pieces exist, whose turn it is, whether the king is in check, and which pieces are attacked or defended. "
        "Prolog applies prioritized rules to those facts and returns clear advice. For example, check has priority 99, while an undefended piece has priority 95. "
        "The important distinction is that Stockfish still calculates the move. Prolog explains chess principles in a deterministic, traceable way."
    )
    text_block(c, talk, 66, 337, 380, size=13.5, color=CREAM, leading=19)
    panel(c, 494, 92, 416, 326, fill=PANEL_2)
    pill(c, "LIKELY Q&A", 514, 375, fill=BLUE)
    qa = [
        ("Why Prolog?", "Its rule-based logic is transparent and easy to explain."),
        ("Does it choose moves?", "No. Stockfish performs the move search."),
        ("How is the board connected?", "FEN becomes temporary Prolog facts for each request."),
        ("What if Prolog is missing?", "The Logician shows a setup hint; the rest of Sentio continues."),
        ("How can it improve?", "Add rules for forks, pins, king safety, pawn structure, and richer context."),
    ]
    y = 338
    for q, a in qa:
        c.setFillColor(BLUE)
        c.setFont("Helvetica-Bold", 11.5)
        c.drawString(514, y, q)
        y = text_block(c, a, 514, y - 17, 372, size=10.5, color=CREAM, leading=14) - 8
    c.setFillColor(FAINT)
    c.setFont("Helvetica", 7.5)
    sources = "Sources reviewed: prolog/ai_system.pl | backend/main.py | app/api/prolog/route.ts | components/LogicianPanel.tsx | README.md"
    c.drawString(47, 43, sources)
    c.showPage()


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("Sentio Prolog Presenter Review Guide")
    c.setAuthor("Sentio Project Team")
    for page in [page_1, page_2, page_3, page_4, page_5, page_6, page_7, page_8, page_9, page_10]:
        page(c)
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
