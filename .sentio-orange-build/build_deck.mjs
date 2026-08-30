import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "/Users/yuza/chess-agent-v2";
const BUILD = path.join(ROOT, ".sentio-orange-build");
const ASSETS = path.join(BUILD, "assets");
const TEMPLATE_PDF = "/Users/yuza/Downloads/Orange Beige Retro Illustration Night Chess Presentation.pdf";
const SOURCE_DECK = "/Users/yuza/Downloads/Sentio_AI_Features_Prolog_Light_Ember (1).pptx";
const FINAL = path.join(ROOT, "Sentio_AI_Orange_Beige_Retro_2026.pptx");

const W = 1280;
const H = 720;
const C = {
  cream: "#F2EBD3",
  cream2: "#EDE4C9",
  dark: "#12100E",
  brown: "#AF3F00",
  orange: "#FF6B18",
  orange2: "#F15A24",
  yellow: "#FBC313",
  ink: "#3A2B2B",
  muted: "#715F52",
  pink: "#F2D9DE",
  white: "#FFF9ED",
};
const TITLE = "Futura Condensed ExtraBold";
const BODY = "Helvetica Neue";
const SCRIPT = "SignPainter";

const assetCache = new Map();
async function bytes(file) {
  if (!assetCache.has(file)) assetCache.set(file, new Uint8Array(await fs.readFile(file)));
  return assetCache.get(file);
}

function rect(slide, name, left, top, width, height, fill, radius = 0, lineFill = "none", lineWidth = 0) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    name,
    position: { left, top, width, height },
    fill,
    line: { style: "solid", fill: lineFill, width: lineWidth },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function textBox(slide, name, text, left, top, width, height, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position: { left, top, width, height },
    fill: opts.fill ?? "none",
    line: { style: "solid", fill: opts.lineFill ?? "none", width: opts.lineWidth ?? 0 },
    ...(opts.radius ? { borderRadius: opts.radius } : {}),
  });
  shape.text = text;
  shape.text.style = {
    typeface: opts.typeface ?? BODY,
    fontSize: opts.fontSize ?? 20,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    lineSpacing: opts.lineSpacing ?? 1.05,
    autoFit: "none",
    wrap: "square",
    insets: opts.insets ?? { top: 4, right: 4, bottom: 4, left: 4 },
  };
  return shape;
}

function retroText(slide, name, text, left, top, width, height, size = 50, color = C.brown, align = "left") {
  textBox(slide, `${name}-shadow`, text, left + 3, top + 3, width, height, {
    typeface: TITLE, fontSize: size, bold: true, color: C.dark, align, lineSpacing: 0.86, insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  return textBox(slide, name, text, left, top, width, height, {
    typeface: TITLE, fontSize: size, bold: true, color, align, lineSpacing: 0.86, insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

function scriptText(slide, name, text, left, top, width, height, size = 34, align = "left", color = C.orange) {
  return textBox(slide, name, text, left, top, width, height, {
    typeface: SCRIPT, fontSize: size, bold: true, color, align, lineSpacing: 0.9,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

function addBase(slide, section, num, title, accent) {
  slide.background.fill = C.cream;
  for (let i = 0; i < 9; i++) {
    rect(slide, `stripe-${i}`, i * 150, 0, 54, H, i % 2 ? "#EFE6CC" : "#F6EFD9");
  }
  textBox(slide, "section", `SENTIO / ${section.toUpperCase()}`, 48, 26, 620, 24, {
    typeface: BODY, fontSize: 12, bold: true, color: C.orange, insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  textBox(slide, "page-number", String(num).padStart(2, "0"), 1168, 20, 64, 40, {
    typeface: TITLE, fontSize: 28, bold: true, color: C.brown, align: "right", insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  retroText(slide, "title", title.toUpperCase(), 48, 65, 1080, 92, 43, C.brown);
  if (accent) scriptText(slide, "accent", accent, 52, 123, 650, 46, 31);
  rect(slide, "title-rule", 48, 170, 1184, 3, C.orange);
}

function addNotes(slide, sources, presenter = "") {
  const lines = [];
  if (presenter) lines.push(presenter, "");
  lines.push("[Sources]");
  lines.push(`- ${TEMPLATE_PDF} (visual template and all decorative assets)`);
  for (const source of sources) lines.push(`- ${source}`);
  slide.speakerNotes.textFrame.setText(lines.join("\n"));
  slide.speakerNotes.setVisible(true);
}

async function image(slide, file, alt, left, top, width, height, fit = "contain") {
  return slide.images.add({
    blob: await bytes(file), contentType: "image/png", alt, fit,
    position: { left, top, width, height },
  });
}

function card(slide, name, left, top, width, height, heading, body, opts = {}) {
  const fill = opts.fill ?? C.brown;
  rect(slide, `${name}-card`, left, top, width, height, fill, 18, opts.line ?? C.dark, 1.5);
  textBox(slide, `${name}-heading`, heading.toUpperCase(), left + 18, top + 16, width - 36, 44, {
    typeface: TITLE, fontSize: opts.headingSize ?? 25, bold: true, color: opts.headingColor ?? C.white,
    lineSpacing: 0.92, insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  textBox(slide, `${name}-body`, body, left + 18, top + 68, width - 36, height - 84, {
    typeface: BODY, fontSize: opts.bodySize ?? 17, color: opts.bodyColor ?? C.white,
    lineSpacing: 1.12, insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

function footer(slide, text) {
  textBox(slide, "footer", text, 48, 684, 1184, 24, {
    typeface: BODY, fontSize: 12, bold: true, color: C.muted, align: "center",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });
presentation.theme.colorScheme = {
  name: "Orange Beige Retro",
  themeColors: {
    accent1: C.orange, accent2: C.brown, accent3: C.yellow, accent4: C.pink,
    accent5: C.cream2, accent6: C.muted, bg1: C.cream, bg2: C.cream2,
    tx1: C.dark, tx2: C.ink, dk1: C.dark, dk2: C.ink, lt1: C.white, lt2: C.cream,
    hlink: C.orange, folHlink: C.brown,
  },
};

// 01 - Cover
{
  const s = presentation.slides.add();
  s.background.fill = C.cream;
  for (let i = 0; i < 10; i++) rect(s, `stripe-${i}`, i * 128, 0, 52, H, i % 2 ? "#EFE6CC" : "#F6EFD9");
  retroText(s, "sentio", "SENTIO", 64, 58, 700, 150, 102, C.brown);
  scriptText(s, "strap", "Chess that reads the player", 72, 160, 730, 78, 46);
  textBox(s, "subtitle", "Emotion-adaptive chess intelligence powered by search, symbolic Prolog reasoning, language, voice, and a new learning loop.", 72, 262, 590, 130, {
    typeface: BODY, fontSize: 24, bold: true, color: C.ink, lineSpacing: 1.16,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  rect(s, "spotlight", 72, 425, 400, 90, C.brown, 18, C.dark, 2);
  textBox(s, "spotlight-text", "PROLOG SPOTLIGHT\nPOSITION -> FACTS -> PRIORITIZED ADVICE", 94, 440, 360, 64, {
    typeface: TITLE, fontSize: 19, bold: true, color: C.white, lineSpacing: 0.96,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await image(s, path.join(ASSETS, "player_thinking.png"), "Retro chess player thinking over a board, cropped from the Orange Beige template", 790, 38, 450, 640);
  footer(s, "AI FEATURES + CURRENT PROJECT UPDATE / 2026");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "README.md")], "Open with the product idea: Sentio adapts to both the board and the person sitting behind it.");
}

// 02 - Adaptive loop
{
  const s = presentation.slides.add();
  addBase(s, "AI system", 2, "The opponent adapts to the human", "A different way to play");
  const stages = [
    ["01", "OBSERVE", "Face blendshapes + game telemetry"],
    ["02", "INTERPRET", "Six game-relevant emotion states"],
    ["03", "ADAPT", "Depth, skill level, and ELO"],
    ["04", "EXPLAIN", "Coach language + Prolog advice"],
  ];
  stages.forEach((d, i) => {
    const x = 58 + i * 296;
    card(s, `stage-${i}`, x, 230, 260, 275, d[1], d[2], { fill: i % 2 ? C.orange : C.brown, headingSize: 27, bodySize: 18 });
    textBox(s, `stage-num-${i}`, d[0], x + 182, 194, 72, 38, { typeface: TITLE, fontSize: 27, bold: true, color: C.brown, align: "right", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  textBox(s, "goal", "GOAL: sustain flow - reduce friction when the player struggles and raise the challenge when confidence grows.", 110, 555, 1060, 66, {
    typeface: BODY, fontSize: 22, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 18,
  });
  footer(s, "THE BOARD CHANGES. THE CHALLENGE AND COMMUNICATION CHANGE WITH IT.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "lib/emotionFusion.ts"), path.join(ROOT, "lib/engineProfiles.ts")]);
}

// 03 - Layers
{
  const s = presentation.slides.add();
  addBase(s, "architecture", 3, "Five intelligence layers cooperate", "One experience");
  const rows = [
    ["PERCEPTION", "MediaPipe + face models", "valence, arousal, expressions"],
    ["ADAPTATION", "Emotion fusion", "player state -> engine profile"],
    ["SEARCH", "Stockfish + Minimax / MCTS", "moves, scores, decision traces"],
    ["SYMBOLIC LOGIC", "SWI-Prolog", "explainable prioritized advice"],
    ["LANGUAGE + VOICE", "LLM + STT / TTS", "natural coaching + Burmese access"],
  ];
  rows.forEach((r, i) => {
    const y = 210 + i * 86;
    rect(s, `layer-bar-${i}`, 70, y, 8, 58, i === 3 ? C.orange : i === 2 ? C.yellow : C.brown, 4);
    textBox(s, `layer-${i}-name`, r[0], 96, y + 2, 205, 25, { typeface: TITLE, fontSize: 20, bold: true, color: i === 3 ? C.orange : C.brown, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `layer-${i}-tech`, r[1], 315, y, 390, 28, { typeface: BODY, fontSize: 19, bold: true, color: C.ink, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `layer-${i}-meaning`, r[2], 315, y + 29, 420, 24, { typeface: BODY, fontSize: 15, color: C.muted, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  await image(s, path.join(ASSETS, "checker_corner.png"), "Orange and black checkerboard corner from the Orange Beige template", 835, 160, 445, 560, "cover");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "AI_SYSTEM.txt"), path.join(ROOT, "package.json")]);
}

// 04 - Boundaries
{
  const s = presentation.slides.add();
  addBase(s, "system boundaries", 4, "Signals cross explicit boundaries", "Every boundary has a fallback");
  const nodes = [
    ["BROWSER", "webcam\nboard\nvoice"],
    ["NEXT.JS", "API routes\nvalidation"],
    ["FASTAPI", "engine pool\nFEN bridge"],
    ["AI ENGINES", "Stockfish\nProlog"],
    ["OUTPUT", "move\nadvice\ncoach"],
  ];
  nodes.forEach((n, i) => {
    const x = 66 + i * 236;
    card(s, `node-${i}`, x, 248, 190, 215, n[0], n[1], { fill: i % 2 ? C.orange : C.brown, headingSize: 24, bodySize: 18 });
    if (i < nodes.length - 1) {
      textBox(s, `arrow-${i}`, ">", x + 195, 308, 38, 54, { typeface: TITLE, fontSize: 42, bold: true, color: C.dark, align: "center", valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    }
  });
  textBox(s, "routes", "/api/bot-move     /api/prolog     /api/coach     /api/transcribe", 150, 500, 980, 48, { typeface: BODY, fontSize: 18, bold: true, color: C.brown, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  textBox(s, "fallback", "The core game remains playable when Prolog, the LLM, or cloud speech is unavailable.", 160, 570, 960, 58, { typeface: BODY, fontSize: 22, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 16 });
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "app/api/bot-move/route.ts"), path.join(ROOT, "app/api/prolog/route.ts"), path.join(ROOT, "app/api/coach/route.ts"), path.join(ROOT, "app/api/transcribe/route.ts"), path.join(ROOT, "backend/main.py")]);
}

// 05 - Emotion fusion
{
  const s = presentation.slides.add();
  addBase(s, "perception", 5, "Emotion is a live signal - not a label", "Anatomy meets gameplay context");
  card(s, "face", 70, 225, 470, 325, "FACIAL SIGNAL", "52 blendshapes\n\nSmile, frown, brow, eye, jaw, and mouth motion mix into valence and arousal.\n\nvalence: positive / negative\narousal: calm / activated", { fill: C.brown, headingSize: 28, bodySize: 18 });
  card(s, "game", 585, 225, 470, 325, "GAME SIGNAL", "12s+ think time -> focus / calm\n150cp setback -> stress evidence\nRecent mistakes -> neutral damping\n+300cp advantage -> confidence", { fill: C.orange, headingSize: 28, bodySize: 18 });
  await image(s, path.join(ASSETS, "pawn_right.png"), "Pink pawn sticker from the Orange Beige template", 1040, 195, 210, 450);
  textBox(s, "fusion", "Fusion adjusts soft scores; it does not blindly overwrite the face signal.", 160, 585, 880, 55, { typeface: BODY, fontSize: 21, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 16 });
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "hooks/useEmotionDetection.ts"), path.join(ROOT, "lib/emotionFusion.ts"), path.join(ROOT, "lib/blendshapeEmotion.ts")]);
}

// 06 - Profiles
{
  const s = presentation.slides.add();
  addBase(s, "adaptation", 6, "Six profiles reshape difficulty", "In real time");
  const profiles = [
    ["STRESSED", 1320, 1, 1, 0.34], ["FRUSTRATED", 1320, 2, 3, 0.34],
    ["CALM", 1600, 4, 6, 0.46], ["NEUTRAL", 2000, 6, 10, 0.60],
    ["FOCUSED", 2600, 8, 15, 0.79], ["CONFIDENT", 3190, 10, 20, 1.0],
  ];
  textBox(s, "heads", "EMOTION                      ELO         RELATIVE STRENGTH                         DEPTH / SKILL", 95, 202, 980, 24, { typeface: BODY, fontSize: 13, bold: true, color: C.muted, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  profiles.forEach((p, i) => {
    const y = 240 + i * 62;
    textBox(s, `profile-${i}`, p[0], 95, y, 210, 30, { typeface: TITLE, fontSize: 20, bold: true, color: i < 2 ? C.orange2 : C.brown, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `elo-${i}`, String(p[1]), 325, y, 90, 30, { typeface: BODY, fontSize: 17, bold: true, color: C.ink, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    rect(s, `bar-bg-${i}`, 450, y + 5, 380, 18, C.cream2, 9, C.brown, 1);
    rect(s, `bar-${i}`, 450, y + 5, 380 * p[4], 18, i === 5 ? C.orange : i === 4 ? C.yellow : C.brown, 9);
    textBox(s, `ds-${i}`, `${p[2]} / ${p[3]}`, 880, y, 110, 30, { typeface: BODY, fontSize: 17, bold: true, color: C.ink, align: "right", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  await image(s, path.join(ASSETS, "abstract_stack.png"), "Abstract stacked chess pieces from the Orange Beige template", 1010, 185, 235, 470);
  footer(s, "HINTS USE A STRONGER FIXED PROFILE SO ADVICE QUALITY STAYS HIGH.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "prolog/ai_system.pl"), path.join(ROOT, "lib/engineProfiles.ts")]);
}

// 07 - Prolog divider
{
  const s = presentation.slides.add();
  s.background.fill = C.cream;
  for (let i = 0; i < 9; i++) rect(s, `stripe-${i}`, i * 150, 0, 55, H, i % 2 ? "#EFE6CC" : "#F6EFD9");
  await image(s, path.join(ASSETS, "pawn_left.png"), "Large pink pawn sticker from the Orange Beige template", 0, 68, 250, 590);
  await image(s, path.join(ASSETS, "pawn_right.png"), "Large pink pawn sticker from the Orange Beige template", 1030, 68, 250, 590);
  retroText(s, "divider-title", "SEARCH FINDS\nSTRONG MOVES", 260, 90, 760, 180, 66, C.brown, "center");
  scriptText(s, "divider-accent", "Prolog makes reasoning visible", 270, 275, 740, 72, 46, "center");
  textBox(s, "stockfish", "STOCKFISH\nWhat move scores best?", 305, 395, 285, 120, { typeface: TITLE, fontSize: 28, bold: true, color: C.white, align: "center", valign: "middle", fill: C.brown, radius: 18 });
  textBox(s, "logician", "THE LOGICIAN\nWhich rule applies - and why now?", 690, 395, 285, 120, { typeface: TITLE, fontSize: 28, bold: true, color: C.white, align: "center", valign: "middle", fill: C.orange, radius: 18 });
  footer(s, "PROLOG IS THE EXPLAINABLE BRIDGE BETWEEN POSITION STATE AND HUMAN GUIDANCE.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "prolog/ai_system.pl"), path.join(ROOT, "components/LogicianPanel.tsx")]);
}

// 08 - Facts rules advice
{
  const s = presentation.slides.add();
  addBase(s, "Prolog spotlight", 8, "Facts, rules, and advice stay separate", "Priority is data");
  card(s, "facts", 65, 225, 345, 350, "DYNAMIC FACTS", "piece(e4, white, pawn)\nturn(white)\nmove_number(7)\nattacked_by(c3, black)\ndefended_by(c3, white)", { fill: C.brown, bodySize: 17 });
  card(s, "concepts", 468, 225, 345, 350, "DERIVED CONCEPTS", "hanging_mine/2\nfree_capture/2\nundeveloped_minor/2\nneeds_castling/0\nno_center_presence/0", { fill: C.orange, bodySize: 17 });
  card(s, "advice", 870, 225, 345, 350, "PRIORITIZED ADVICE", "99 safety / check\n95 tactics / hanging\n90 tactics / free capture\n85 opening / castle\n60 endgame / activate king", { fill: C.brown, bodySize: 17 });
  textBox(s, "meaning", "The UI can sort deterministically because priority lives in the knowledge base - not in hidden model behavior.", 150, 605, 980, 44, { typeface: BODY, fontSize: 19, bold: true, color: C.ink, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "prolog/ai_system.pl")]);
}

// 09 - Bridge
{
  const s = presentation.slides.add();
  addBase(s, "Prolog bridge", 9, "FEN becomes declarative logic", "Imperative state -> explicit facts");
  const steps = [
    ["1", "FEN", "live board"], ["2", "PYTHON\nCHESS", "parse"], ["3", "ASSERT", "facts"],
    ["4", "QUERY", "advice(P,C,T)"], ["5", "JSON", "top 6 sorted"], ["6", "LOGICIAN", "category + reason"],
  ];
  steps.forEach((st, i) => {
    const x = 45 + i * 203;
    rect(s, `step-${i}`, x, 260, 165, 170, i % 2 ? C.orange : C.brown, 18, C.dark, 2);
    textBox(s, `step-n-${i}`, st[0], x + 12, 270, 36, 36, { typeface: TITLE, fontSize: 26, bold: true, color: C.yellow, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `step-title-${i}`, st[1], x + 16, 320, 133, 34, { typeface: TITLE, fontSize: 20, bold: true, color: C.white, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `step-body-${i}`, st[2], x + 14, 365, 137, 45, { typeface: BODY, fontSize: 15, color: C.white, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    if (i < steps.length - 1) textBox(s, `chev-${i}`, ">", x + 168, 312, 31, 54, { typeface: TITLE, fontSize: 36, bold: true, color: C.dark, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  textBox(s, "lock", "CONCURRENCY SAFEGUARD\nA lock protects the shared Prolog instance while old facts are retracted, new facts are asserted, and the query runs.", 115, 485, 1050, 95, { typeface: BODY, fontSize: 18, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 18 });
  footer(s, "PROLOG REMAINS OBSERVATIONAL: IT NEVER EXECUTES A CHESS MOVE.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "backend/main.py"), path.join(ROOT, "app/api/prolog/route.ts")]);
}

// 10 - Example
{
  const s = presentation.slides.add();
  addBase(s, "Prolog example", 10, "A hanging bishop becomes priority 95", "Every phrase is grounded");
  card(s, "asserted", 75, 225, 455, 350, "ASSERTED FACTS", "turn(white).\npiece(c3, white, bishop).\nattacked_by(c3, black).\n% no defended_by(c3, white).\n\nhanging_mine(c3, bishop).", { fill: C.brown, bodySize: 18 });
  textBox(s, "big-arrow", ">", 548, 340, 82, 80, { typeface: TITLE, fontSize: 62, bold: true, color: C.orange, align: "center", valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  rect(s, "result-box", 650, 225, 540, 350, C.cream2, 22, C.orange, 3);
  textBox(s, "priority", "TACTICS / PRIORITY 95", 680, 250, 300, 32, { typeface: TITLE, fontSize: 21, bold: true, color: C.orange, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  textBox(s, "recommendation", "YOUR BISHOP ON C3 IS ATTACKED AND UNDEFENDED - DEFEND IT OR MOVE IT.", 680, 315, 470, 120, { typeface: TITLE, fontSize: 31, bold: true, color: C.dark, lineSpacing: 0.94, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  textBox(s, "explain", "WHY THIS IS EXPLAINABLE\nThe advice names a visible predicate, a named rule, and a deterministic priority.", 680, 470, 460, 70, { typeface: BODY, fontSize: 17, bold: true, color: C.ink, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "prolog/ai_system.pl")]);
}

// 11 - Hybrid AI
{
  const s = presentation.slides.add();
  addBase(s, "hybrid AI", 11, "Each engine owns the job it does best", "One system, three strengths");
  card(s, "sf", 65, 225, 345, 365, "STOCKFISH", "ROLE\nSearch and evaluation\n\nOUTPUT\nBest move + score\n\nSTRENGTH\nTactical depth\n\nLIMIT\nHard to narrate directly", { fill: C.brown, bodySize: 16 });
  card(s, "pl", 468, 225, 345, 365, "PROLOG", "ROLE\nRules and explanation\n\nOUTPUT\nRanked advice\n\nSTRENGTH\nTransparent logic\n\nLIMIT\nNarrow encoded knowledge", { fill: C.orange, bodySize: 16 });
  card(s, "llm", 870, 225, 345, 365, "LLM COACH", "ROLE\nDialogue and language\n\nOUTPUT\nNatural coaching\n\nSTRENGTH\nFlexible communication\n\nLIMIT\nNeeds grounding + fallback", { fill: C.brown, bodySize: 16 });
  footer(s, "HYBRID DESIGN TURNS ONE OPAQUE 'AI' INTO ACCOUNTABLE, COMPOSABLE CAPABILITIES.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "backend/main.py"), path.join(ROOT, "app/api/coach/route.ts"), path.join(ROOT, "prolog/ai_system.pl")]);
}

// 12 - AI Lab update
{
  const s = presentation.slides.add();
  addBase(s, "current update / AI Lab", 12, "Search behavior becomes inspectable", "Live analysis, not a black box");
  await image(s, path.join(ASSETS, "middle_collage.png"), "Retro chess and strategy collage from the Orange Beige template", 820, 178, 460, 542, "cover");
  const rows = [
    ["LIVE-GAME SCOPE", "Analysis waits for the first real move and follows the current position."],
    ["TWO ALGORITHMS", "Switch between Minimax branch-and-prune traces and MCTS rollouts."],
    ["TWO VIEWS", "Inspect the position as a board or orbit the 3D search graph."],
    ["VISIBLE WORK", "Surface depth, evaluated leaves, rollouts, root visits, and pruned branches."],
  ];
  rows.forEach((r, i) => {
    const y = 220 + i * 93;
    rect(s, `lab-row-${i}`, 65, y, 695, 74, i % 2 ? C.orange : C.brown, 14, C.dark, 1);
    textBox(s, `lab-h-${i}`, r[0], 85, y + 11, 220, 24, { typeface: TITLE, fontSize: 19, bold: true, color: C.yellow, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `lab-b-${i}`, r[1], 310, y + 10, 425, 54, { typeface: BODY, fontSize: 16, color: C.white, valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  textBox(s, "update-note", "CURRENT CHECKOUT: the full-width component follows the live position and waits for the first real move.", 90, 610, 650, 50, { typeface: BODY, fontSize: 16, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 14 });
  addNotes(s, [path.join(ROOT, "components/AILabWorkspace.tsx"), path.join(ROOT, "components/AIAnalysisTab.tsx"), path.join(ROOT, "components/AgentsGraph3D.tsx"), path.join(ROOT, "app/page.tsx")]);
}

// 13 - Benchmarks
{
  const s = presentation.slides.add();
  addBase(s, "current update / benchmarks", 13, "Search trade-offs are measurable", "One position, six depths, two algorithms");
  textBox(s, "benchmark-context", "OPENING RESPONSE / DEPTH 6 / 5 SAMPLES + 2 WARMUPS", 70, 205, 760, 26, { typeface: BODY, fontSize: 14, bold: true, color: C.muted, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  const metrics = [
    ["MINIMAX", "837.8 ms", "1,103 evaluated leaves", "1,572 pruned branches", C.brown],
    ["MCTS", "578.7 ms", "144 rollout work units", "145 search nodes", C.orange],
  ];
  metrics.forEach((m, i) => card(s, `metric-${i}`, 70 + i * 400, 250, 355, 275, m[0], `${m[1]}\n\n${m[2]}\n${m[3]}`, { fill: m[4], headingSize: 30, bodySize: 20 }));
  rect(s, "mini-bg", 890, 270, 300, 38, C.cream2, 12, C.dark, 1);
  rect(s, "mini", 890, 270, 300, 38, C.brown, 12);
  textBox(s, "mini-label", "MINIMAX  837.8 ms", 902, 278, 250, 22, { typeface: TITLE, fontSize: 15, bold: true, color: C.white, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  rect(s, "mcts-bg", 890, 350, 300, 38, C.cream2, 12, C.dark, 1);
  rect(s, "mcts", 890, 350, 207, 38, C.orange, 12);
  textBox(s, "mcts-label", "MCTS  578.7 ms", 902, 358, 180, 22, { typeface: TITLE, fontSize: 15, bold: true, color: C.white, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  textBox(s, "interpretation", "Interpretation: workload definitions differ - Minimax counts evaluated leaves; MCTS counts rollout iterations. The UI exposes both instead of forcing a misleading single ranking.", 870, 435, 340, 125, { typeface: BODY, fontSize: 16, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 16 });
  footer(s, "BENCHMARK GENERATED 2026-08-15 / LOCAL TRACE BUILDERS");
  addNotes(s, [path.join(ROOT, "benchmarks/search-benchmark.json"), path.join(ROOT, "components/BenchmarkTab.tsx")]);
}

// 14 - Language and voice
{
  const s = presentation.slides.add();
  addBase(s, "language + voice", 14, "Language stays grounded and safe", "Two voice paths, two different permissions");
  card(s, "coach", 65, 230, 355, 330, "COACH", "FEN + emotion + question\n-> legal moves + best move\n-> Groq or local LLM\n-> structured fallback advice", { fill: C.brown, bodySize: 17 });
  card(s, "voice-move", 463, 230, 355, 330, "VOICE MOVE", "Audio -> transcript\n-> parseChessMove()\n-> legal move validation\n-> board\n\nA command executes only after it resolves to a legal move.", { fill: C.orange, bodySize: 17 });
  card(s, "voice-coach", 861, 230, 355, 330, "VOICE COACH", "Audio -> transcript\n-> editable text\n-> /api/coach\n-> Burmese answer\n-> optional TTS\n\nA question never auto-plays a move.", { fill: C.brown, bodySize: 17 });
  footer(s, "CHESS.JS VALIDATION REMAINS THE AUTHORITY FOR EVERY PLAYABLE MOVE.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "app/api/coach/route.ts"), path.join(ROOT, "app/api/transcribe/route.ts"), path.join(ROOT, "components/VoiceCoachControl.tsx"), path.join(ROOT, "lib/speechParser.ts")]);
}

// 15 - Product surface update
{
  const s = presentation.slides.add();
  addBase(s, "current update / product", 15, "Sentio separates play and learning", "A clearer workspace model");
  await image(s, path.join(ASSETS, "players_board.png"), "Two retro chess players at a board from the Orange Beige template", 690, 185, 560, 250);
  const rows = [
    ["BOARD", "Live game, evaluation, camera signal, emotion timeline, and coach controller."],
    ["AI LAB", "Dedicated full-width component for current-position search inspection."],
    ["TRAIN", "Puzzle Rush, lessons, XP progression, and game-improvement analysis."],
  ];
  rows.forEach((r, i) => {
    const y = 230 + i * 115;
    rect(s, `workspace-${i}`, 65, y, 560, 90, i === 1 ? C.orange : C.brown, 18, C.dark, 1);
    textBox(s, `workspace-h-${i}`, r[0], 85, y + 14, 130, 32, { typeface: TITLE, fontSize: 25, bold: true, color: C.yellow, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `workspace-b-${i}`, r[1], 210, y + 10, 385, 64, { typeface: BODY, fontSize: 16, color: C.white, valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  textBox(s, "controls", "ALSO UPDATED\nDock / float / widen the controller\nSwitch dark / light mode\nChoose piece designs\nExport PGN + replay games", 745, 470, 425, 155, { typeface: BODY, fontSize: 18, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 18 });
  addNotes(s, [path.join(ROOT, "app/page.tsx"), path.join(ROOT, "components/BoardWorkspace.tsx"), path.join(ROOT, "components/AILabWorkspace.tsx"), path.join(ROOT, "components/TopBar.tsx"), path.join(ROOT, "components/ControllerPanel.tsx"), path.join(ROOT, "hooks/useSidebarPreferences.ts")]);
}

// 16 - Training arena
{
  const s = presentation.slides.add();
  addBase(s, "current update / training", 16, "Training closes the learning loop", "Play -> practice -> review -> improve");
  card(s, "rush", 65, 225, 345, 320, "PUZZLE RUSH", "Rush: 3-minute clock\nSurvival: 3 strikes\nDifficulty rises with level\nHints reveal theme and halve XP", { fill: C.brown, bodySize: 17 });
  card(s, "learn", 468, 225, 345, 320, "LEARN POSITIONS", "Curated openings, endgames, and attacks\nEvery SAN sequence is validated by chess.js\nStep through narration or start a game from the lesson FEN", { fill: C.orange, bodySize: 17 });
  card(s, "progress", 870, 225, 345, 320, "PROGRESS", "XP + level + tier\nStreak and theme statistics\nOn-demand game analysis\nAccuracy, blunders, ACPL, and PGN export", { fill: C.brown, bodySize: 17 });
  textBox(s, "mood", "SENTIO TWIST: live mood can adapt the puzzle difficulty when the player is tense.", 145, 585, 990, 60, { typeface: BODY, fontSize: 21, bold: true, color: C.ink, align: "center", valign: "middle", fill: C.yellow, radius: 18 });
  addNotes(s, [path.join(ROOT, "components/train/TrainingWorkspace.tsx"), path.join(ROOT, "components/train/PuzzleRush.tsx"), path.join(ROOT, "components/train/LearnPositions.tsx"), path.join(ROOT, "components/train/ProgressView.tsx"), path.join(ROOT, "lib/puzzleProgress.ts"), path.join(ROOT, "lib/gameAnalysis.ts"), path.join(ROOT, "lib/lessons.ts")]);
}

// 17 - Reliability and tests
{
  const s = presentation.slides.add();
  addBase(s, "reliability", 17, "The core game survives partial AI failure", "Boundaries make the product trustworthy");
  const items = [
    ["PROLOG UNAVAILABLE", "Logician shows setup guidance; game logic is unaffected."],
    ["LLM UNAVAILABLE", "Structured fallback coaching remains position-aware."],
    ["CLOUD STT UNAVAILABLE", "Local Whisper or another provider can take over."],
    ["STOCKFISH BUSY", "The bounded pool returns an explicit 503 instead of corrupt state."],
    ["STALE RESPONSE", "Sequence checks ignore obsolete Logician requests."],
  ];
  items.forEach((it, i) => {
    const y = 215 + i * 73;
    rect(s, `reliability-${i}`, 65, y, 795, 58, i % 2 ? C.orange : C.brown, 13, C.dark, 1);
    textBox(s, `rel-h-${i}`, it[0], 82, y + 9, 230, 38, { typeface: TITLE, fontSize: 18, bold: true, color: C.yellow, valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    textBox(s, `rel-b-${i}`, it[1], 310, y + 7, 525, 42, { typeface: BODY, fontSize: 15, color: C.white, valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  rect(s, "test-card", 905, 245, 300, 300, C.yellow, 24, C.dark, 2);
  textBox(s, "test-big", "145 / 145", 930, 285, 250, 85, { typeface: TITLE, fontSize: 52, bold: true, color: C.dark, align: "center", valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  scriptText(s, "test-accent", "tests passed", 935, 365, 240, 58, 39, "center", C.orange);
  textBox(s, "test-small", "15 unit test files\nverified 2026-08-29", 950, 435, 210, 60, { typeface: BODY, fontSize: 17, bold: true, color: C.ink, align: "center", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  footer(s, "A ROBUST AI PRODUCT IS DEFINED AS MUCH BY ITS BOUNDARIES AS BY ITS MODELS.");
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "backend/main.py"), path.join(ROOT, "components/LogicianPanel.tsx"), path.join(ROOT, "app/api/coach/route.ts"), path.join(ROOT, "package.json")], "Verification: npm run test passed 15 files and 145 tests on 2026-08-29.");
}

// 18 - Close using the original template's final page as the dominant visual.
{
  const s = presentation.slides.add();
  await image(s, path.join(BUILD, "template-pages", "page-10.png"), "Orange Beige template closing slide with retro knight and rook", 0, 0, W, H, "cover");
  rect(s, "closing-band", 0, 555, W, 165, C.cream, 0);
  textBox(s, "closing-kicker", "SENTIO SYNTHESIS", 58, 578, 230, 28, { typeface: BODY, fontSize: 13, bold: true, color: C.orange, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  retroText(s, "closing-title", "ONE ADAPTIVE LOOP", 55, 605, 500, 65, 43, C.brown);
  scriptText(s, "closing-accent", "Five forms of intelligence", 560, 596, 430, 55, 33, "left");
  textBox(s, "closing-body", "PERCEPTION READS THE PLAYER  /  SEARCH READS THE BOARD  /  PROLOG MAKES RULES VISIBLE  /  LANGUAGE MAKES GUIDANCE USABLE  /  TRAINING MAKES IMPROVEMENT CONTINUOUS", 555, 650, 675, 42, { typeface: BODY, fontSize: 12, bold: true, color: C.ink, align: "center", valign: "middle", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  addNotes(s, [SOURCE_DECK, path.join(ROOT, "prolog/ai_system.pl"), path.join(ROOT, "components/train/TrainingWorkspace.tsx")], "Close by returning to the thesis: trustworthy AI is a coordinated system of models, rules, state, safeguards, and learning feedback.");
}

await fs.mkdir(path.join(BUILD, "rendered"), { recursive: true });
for (let i = 0; i < presentation.slides.items.length; i++) {
  const slide = presentation.slides.getItem(i);
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(BUILD, "rendered", `slide-${i + 1}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(BUILD, "rendered", `slide-${i + 1}.layout.json`), new Uint8Array(await layout.arrayBuffer()));
}
const montage = await presentation.export({ format: "png", montage: { format: "png", columns: 4, slideWidth: 320, padding: 14, gap: 12, background: "#E4D8BC" } });
await fs.writeFile(path.join(BUILD, "montage.png"), new Uint8Array(await montage.arrayBuffer()));
const inspect = await presentation.inspect({ kind: "deck,slide,textbox,shape,image,notes", maxChars: 200000 });
await fs.writeFile(path.join(BUILD, "final-inspect.ndjson"), inspect.ndjson, "utf8");
const out = await PresentationFile.exportPptx(presentation);
await out.save(FINAL);
console.log(`Saved ${FINAL}`);
