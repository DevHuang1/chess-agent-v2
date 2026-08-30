import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT = "/Users/yuza/chess-agent-v2/Sentio_AI_Features_Prolog_Ember.pptx";
const BUILD = "/Users/yuza/chess-agent-v2/.presentation-build";
const ASSETS = `${BUILD}/assets`;
const W = 1280, H = 720;
const C = {
  bg: "#080B12", panel: "#111722", panel2: "#171E2B", ink: "#F4F4F5",
  muted: "#9AA3B6", amber: "#F59E0B", amber2: "#FBBF24", cream: "#EBECD0",
  olive: "#779556", cyan: "#22D3EE", blue: "#38BDF8", green: "#34D399",
  red: "#F87171", orange: "#FB923C", purple: "#A78BFA", line: "#2A3241",
};

const p = Presentation.create({ slideSize: { width: W, height: H } });

function shape(slide, geometry, x, y, w, h, fill, line = "none", radius) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function text(slide, value, x, y, w, h, size = 20, color = C.ink, opts = {}) {
  const t = shape(slide, "textbox", x, y, w, h, "none");
  t.text = value;
  t.text.style = {
    fontSize: size,
    fontFamily: opts.mono ? "Menlo" : "Aptos Display",
    color,
    bold: !!opts.bold,
    italic: !!opts.italic,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
  };
  return t;
}

function line(slide, x, y, w, color = C.amber, h = 3) {
  return shape(slide, "rect", x, y, w, h, color);
}

function pill(slide, label, x, y, w, color = C.amber) {
  shape(slide, "roundRect", x, y, w, 28, `${color}22`, color, "rounded-xl");
  text(slide, label, x, y + 2, w, 22, 12, color, { bold: true, align: "center", mono: true, valign: "middle" });
}

function base(slide, n, section = "SENTIO / AI SYSTEM") {
  slide.background.fill = C.bg;
  text(slide, section, 58, 28, 430, 24, 12, C.amber, { bold: true, mono: true });
  line(slide, 58, 58, 52, C.amber, 3);
  text(slide, String(n).padStart(2, "0"), 1182, 28, 42, 22, 12, C.muted, { mono: true, align: "right" });
}

function title(slide, value, sub) {
  text(slide, value, 58, 78, 1164, 58, 38, C.ink, { bold: true });
  if (sub) text(slide, sub, 60, 140, 1110, 42, 18, C.muted);
}

function notes(slide, files, talk = "") {
  slide.speakerNotes.textFrame.setText(`${talk}\n\n[Sources]\n${files.map(f => `- Local repository: ${f}`).join("\n")}`);
}

async function imageOn(slide, filename, x, y, w, h, fit = "cover", alt = "Sentio product screenshot") {
  const blob = await fs.readFile(`${ASSETS}/${filename}`);
  slide.images.add({ blob, contentType: "image/png", alt, fit, geometry: "roundRect", borderRadius: "rounded-xl", position: { left: x, top: y, width: w, height: h } });
}

// 1 — cover
{
  const s = p.slides.add(); s.background.fill = C.bg;
  shape(s, "ellipse", 820, 0, 460, 460, "#F59E0B18");
  shape(s, "ellipse", 900, 300, 380, 380, "#38BDF812");
  text(s, "SENTIO", 60, 52, 320, 28, 14, C.amber, { bold: true, mono: true });
  text(s, "Emotion-adaptive\nchess intelligence", 58, 150, 790, 170, 58, C.ink, { bold: true });
  text(s, "A hybrid AI system combining perception, game search, symbolic reasoning, and natural-language coaching.", 62, 348, 680, 84, 23, C.muted);
  line(s, 62, 474, 210, C.amber, 5);
  text(s, "PROLOG SPOTLIGHT", 62, 496, 260, 24, 13, C.amber2, { bold: true, mono: true });
  text(s, "How live chess positions become transparent, prioritized advice.", 62, 532, 580, 54, 22, C.cream);
  text(s, "AI FEATURES · TECHNICAL PRESENTATION", 62, 646, 460, 20, 11, C.muted, { mono: true });
  shape(s, "roundRect", 815, 118, 350, 420, C.panel, C.line, "rounded-2xl");
  text(s, "♞", 890, 168, 200, 180, 136, C.amber, { align: "center", valign: "middle" });
  text(s, "PERCEIVE", 860, 382, 120, 22, 12, C.cyan, { bold: true, mono: true });
  text(s, "SEARCH", 1018, 382, 100, 22, 12, C.green, { bold: true, mono: true });
  text(s, "REASON", 860, 432, 120, 22, 12, C.amber2, { bold: true, mono: true });
  text(s, "EXPLAIN", 1018, 432, 100, 22, 12, C.purple, { bold: true, mono: true });
  notes(s, ["README.md", "AI_SYSTEM.txt", "app/globals.css"], "Open with the core idea: Sentio does not use one model. It coordinates several forms of intelligence around a live chess game.");
}

// 2
{
  const s=p.slides.add(); base(s,2); title(s,"The opponent adapts to the human—not only the board","Sentio treats emotional state as a live game signal, then changes challenge and communication.");
  const stages=[
    ["01","Observe","Face blendshapes + game telemetry",C.cyan],
    ["02","Interpret","Six game-relevant emotion states",C.purple],
    ["03","Adapt","Depth, skill level, and ELO",C.amber],
    ["04","Explain","Coach language + Prolog advice",C.green],
  ];
  stages.forEach((d,i)=>{const x=60+i*300; shape(s,"roundRect",x,230,260,300,C.panel,C.line,"rounded-xl"); text(s,d[0],x+20,250,50,24,14,d[3],{bold:true,mono:true}); text(s,d[1],x+20,296,220,38,28,C.ink,{bold:true}); line(s,x+20,350,56,d[3],3); text(s,d[2],x+20,380,220,96,19,C.muted);});
  text(s,"Goal: sustain flow—reduce friction when the player struggles, raise challenge when confidence grows.",62,585,1120,50,25,C.cream,{bold:true,align:"center"});
  notes(s,["README.md","AI_SYSTEM.txt","lib/emotionFusion.ts"],"Frame Sentio as a closed adaptive loop. The project responds to both chess position and player state.");
}

// 3
{
  const s=p.slides.add(); base(s,3); title(s,"Five intelligence layers cooperate in one experience");
  const rows=[
    ["PERCEPTION","MediaPipe / face models","Valence, arousal, expressions",C.cyan],
    ["ADAPTATION","Emotion fusion","Player state → engine profile",C.purple],
    ["SEARCH","Stockfish + Minimax / MCTS","Moves, scores, decision traces",C.green],
    ["SYMBOLIC LOGIC","SWI-Prolog","Explainable prioritized advice",C.amber],
    ["LANGUAGE & VOICE","LLM + STT / TTS","Natural coaching and Burmese access",C.orange],
  ];
  rows.forEach((r,i)=>{const y=190+i*88; text(s,r[0],64,y,230,30,14,r[3],{bold:true,mono:true}); shape(s,"rect",298,y+2,5,52,r[3]); text(s,r[1],332,y-2,320,32,24,C.ink,{bold:true}); text(s,r[2],690,y+1,470,44,18,C.muted);});
  notes(s,["README.md","AI_SYSTEM.txt","lib/agents.ts","prolog/ai_system.pl"],"Emphasize that these are different AI paradigms. Their value comes from division of labor rather than forcing one model to do everything.");
}

// 4 architecture
{
  const s=p.slides.add(); base(s,4,"SENTIO / ARCHITECTURE"); title(s,"Signals become moves, advice, and explanations through explicit boundaries");
  const y=250;
  const boxes=[
    [70,180,"BROWSER","Webcam · board · voice",C.cyan],
    [330,180,"NEXT.JS","API routes · validation",C.purple],
    [590,180,"FASTAPI","Engine pool · FEN bridge",C.amber],
    [850,180,"AI ENGINES","Stockfish · Prolog",C.green],
    [1080,180,"OUTPUT","Move · advice · coach",C.orange],
  ];
  boxes.forEach(([x,w,a,b,c])=>{shape(s,"roundRect",x,y,w,150,C.panel,c,"rounded-xl"); text(s,a,x+14,y+24,w-28,28,16,c,{bold:true,mono:true,align:"center"}); text(s,b,x+14,y+70,w-28,50,17,C.ink,{align:"center"});});
  [[250,330],[510,590],[770,850],[1030,1080]].forEach(([x1,x2])=>{line(s,x1+10,y+72,x2-x1-20,C.line,3); shape(s,"chevron",x2-16,y+61,18,24,C.amber);});
  pill(s,"/api/bot-move",352,448,170,C.green); pill(s,"/api/prolog",566,448,150,C.amber); pill(s,"/api/coach",762,448,145,C.purple); pill(s,"/api/transcribe",953,448,180,C.cyan);
  text(s,"Every boundary has a fallback: the game stays playable even when Prolog, the LLM, or cloud speech is unavailable.",100,570,1080,56,24,C.cream,{bold:true,align:"center"});
  notes(s,["README.md","backend/main.py","app/api/prolog/route.ts","app/api/coach/route.ts","app/api/transcribe/route.ts"],"Walk left to right. The architecture separates state capture, routing, engine execution, and audience-facing outputs.");
}

// 5 perception
{
  const s=p.slides.add(); base(s,5,"SENTIO / PERCEPTION"); title(s,"Emotion estimation fuses anatomy with gameplay context");
  shape(s,"roundRect",70,200,500,360,C.panel,C.line,"rounded-xl");
  text(s,"FACIAL SIGNAL",95,225,200,24,13,C.cyan,{bold:true,mono:true});
  text(s,"52 blendshapes",95,270,320,40,30,C.ink,{bold:true});
  text(s,"Smile, frown, brow, eye, jaw, and mouth motion are mixed into valence and arousal.",95,330,410,80,19,C.muted);
  text(s,"valence  ↔  positive / negative",95,440,380,28,17,C.cream,{mono:true});
  text(s,"arousal  ↕  calm / activated",95,480,380,28,17,C.cream,{mono:true});
  shape(s,"roundRect",650,200,560,360,C.panel,C.line,"rounded-xl");
  text(s,"GAME SIGNAL",675,225,200,24,13,C.purple,{bold:true,mono:true});
  const signals=[["12s+ think time","Focused / calm boost"],["150cp setback","Stress evidence"],["Recent mistakes","Neutral dampening"],["+300cp advantage","Confidence reinforcement"]];
  signals.forEach((r,i)=>{text(s,r[0],680,278+i*62,210,26,17,C.ink,{bold:true}); text(s,r[1],915,278+i*62,250,28,17,C.muted); line(s,680,316+i*62,480,C.line,1);});
  text(s,"Fusion adjusts soft scores; it does not blindly overwrite the face signal.",130,600,1020,38,22,C.amber2,{bold:true,align:"center"});
  notes(s,["lib/blendshapeEmotion.ts","lib/emotionFusion.ts"],"Explain the design choice: a quiet face alone cannot reliably separate calm, neutral, and focused. Gameplay telemetry adds context.");
}

// 6 profile chart
{
  const s=p.slides.add(); base(s,6,"SENTIO / ADAPTATION"); title(s,"Six emotion profiles reshape the engine’s challenge in real time");
  const data=[
    ["Stressed",1320,1,1,C.red],["Frustrated",1320,2,3,C.orange],["Calm",1600,4,6,C.blue],
    ["Neutral",2000,6,10,C.muted],["Focused",2600,8,15,C.cyan],["Confident",3190,10,20,C.green],
  ];
  text(s,"EMOTION",65,190,180,24,12,C.muted,{bold:true,mono:true}); text(s,"ELO",275,190,90,24,12,C.muted,{bold:true,mono:true}); text(s,"RELATIVE STRENGTH",410,190,520,24,12,C.muted,{bold:true,mono:true}); text(s,"DEPTH / SKILL",1010,190,180,24,12,C.muted,{bold:true,mono:true});
  data.forEach((d,i)=>{const y=230+i*65; text(s,d[0],65,y,180,30,18,d[4],{bold:true}); text(s,String(d[1]),275,y,90,30,18,C.ink,{mono:true}); shape(s,"roundRect",410,y+4,520,18,C.panel2,"none","rounded-xl"); shape(s,"roundRect",410,y+4,(d[1]/3190)*520,18,d[4],"none","rounded-xl"); text(s,`${d[2]} / ${d[3]}`,1030,y,120,28,18,C.cream,{mono:true,align:"center"});});
  text(s,"Hints deliberately bypass adaptation and use a stronger fixed profile for quality.",66,635,1100,30,18,C.amber2,{italic:true});
  notes(s,["backend/main.py","prolog/ai_system.pl","README.md"],"Call out the three levers: depth, Stockfish Skill Level, and UCI ELO limiting. Prolog mirrors the same static profiles as declarative facts.");
}

// 7 prolog intro
{
  const s=p.slides.add(); base(s,7,"SENTIO / PROLOG SPOTLIGHT"); title(s,"Search finds strong moves; Prolog makes reasoning inspectable");
  text(s,"Stockfish answers:",80,220,380,34,24,C.green,{bold:true});
  text(s,"“What move scores best?”",80,275,450,60,36,C.ink,{bold:true});
  text(s,"Deep search is powerful, but its evaluation is not automatically a clear explanation for a learner.",80,370,450,100,20,C.muted);
  shape(s,"rect",620,190,3,380,C.line);
  text(s,"The Logician answers:",700,220,400,34,24,C.amber,{bold:true});
  text(s,"“Which rule applies—and why now?”",700,275,480,80,36,C.ink,{bold:true});
  text(s,"Advice is traceable to explicit facts and rules: check safety, hanging pieces, free captures, castling, development, center control, and king activation.",700,390,450,115,20,C.muted);
  pill(s,"SYMBOLIC AI",493,590,180,C.amber);
  notes(s,["prolog/ai_system.pl","components/LogicianPanel.tsx"],"Introduce Prolog as complementary, not competitive. It is an explainability layer and a teaching layer alongside search.");
}

// 8 KB anatomy
{
  const s=p.slides.add(); base(s,8,"SENTIO / PROLOG SPOTLIGHT"); title(s,"The knowledge base separates observable facts from reusable rules");
  const cols=[
    [60,350,"DYNAMIC FACTS",["piece(e4, white, pawn)","turn(white)","move_number(7)","attacked_by(c3, black)","defended_by(c3, white)"],C.cyan],
    [465,350,"DERIVED CONCEPTS",["hanging_mine/2","free_capture/2","undeveloped_minor/2","needs_castling/0","no_center_presence/0"],C.purple],
    [870,350,"PRIORITIZED ADVICE",["99  safety / check","95  tactics / hanging","90  tactics / free capture","85  opening / castle","60  endgame / activate king"],C.amber],
  ];
  cols.forEach(([x,w,h,items,c])=>{shape(s,"roundRect",x,200,w,390,C.panel,C.line,"rounded-xl"); text(s,h,x+24,226,w-48,30,15,c,{bold:true,mono:true}); line(s,x+24,270,70,c,3); items.forEach((v,i)=>text(s,v,x+24,306+i*52,w-48,30,17,i<2?C.ink:C.muted,{mono:true}));});
  text(s,"Priority is data—not hidden model behavior—so the UI can sort advice deterministically.",90,625,1100,34,21,C.cream,{bold:true,align:"center"});
  notes(s,["prolog/ai_system.pl"],"Distinguish three levels. Python supplies facts. Prolog derives concepts. Advice rules convert those concepts into ranked human-readable guidance.");
}

// 9 bridge
{
  const s=p.slides.add(); base(s,9,"SENTIO / PROLOG BRIDGE"); title(s,"The bridge converts an imperative board state into declarative logic");
  const steps=[
    ["1","FEN","r1bqk… w KQ",C.cream],
    ["2","python-chess","parse board",C.blue],
    ["3","FACT ASSERTION","piece · turn · attacks",C.cyan],
    ["4","PROLOG QUERY","advice(P,C,T)",C.amber],
    ["5","JSON","top 6 sorted",C.green],
    ["6","LOGICIAN UI","category + reason",C.purple],
  ];
  steps.forEach((d,i)=>{const x=55+i*202; shape(s,"roundRect",x,245,165,190,C.panel,d[3],"rounded-xl"); text(s,d[0],x+15,260,30,26,13,d[3],{bold:true,mono:true}); text(s,d[1],x+15,302,135,48,17,C.ink,{bold:true,align:"center"}); text(s,d[2],x+12,367,141,38,15,C.muted,{mono:true,align:"center"}); if(i<5){shape(s,"chevron",x+174,325,22,32,C.amber);}});
  text(s,"Concurrency safeguard",70,510,270,30,18,C.amber,{bold:true});
  text(s,"A lock protects the shared Prolog instance while old facts are retracted, new facts are asserted, and the query runs.",340,510,820,66,19,C.muted);
  text(s,"Prolog remains observational: it never executes a chess move.",70,618,1100,32,23,C.cream,{bold:true,align:"center"});
  notes(s,["backend/main.py","app/api/prolog/route.ts","components/LogicianPanel.tsx"],"This is the key bridge slide. Explain the representation change: FEN is compact state; Prolog needs explicit relational facts.");
}

// 10 worked example
{
  const s=p.slides.add(); base(s,10,"SENTIO / PROLOG EXAMPLE"); title(s,"A hanging piece becomes a transparent priority-95 recommendation");
  shape(s,"roundRect",60,200,500,410,C.panel,C.line,"rounded-xl");
  text(s,"ASSERTED FACTS",88,225,220,24,13,C.cyan,{bold:true,mono:true});
  const code=["turn(white).","piece(c3, white, bishop).","attacked_by(c3, black).","% no defended_by(c3, white)","","hanging_mine(c3, bishop)."];
  code.forEach((v,i)=>text(s,v,90,275+i*46,420,30,19,i===5?C.amber2:(i===3?C.muted:C.cream),{mono:true,bold:i===5}));
  shape(s,"chevron",590,365,58,70,C.amber);
  shape(s,"roundRect",690,200,530,410,"#1B1510",C.amber,"rounded-xl");
  pill(s,"TACTICS · PRIORITY 95",730,238,230,C.amber);
  text(s,"Your bishop on c3 is attacked and undefended—defend it or move it.",730,310,430,150,32,C.ink,{bold:true});
  text(s,"Why this is explainable",730,500,240,28,18,C.amber2,{bold:true});
  text(s,"Every phrase is grounded in a visible predicate and a named rule.",730,540,420,55,18,C.muted);
  notes(s,["prolog/ai_system.pl","backend/main.py"],"Use this as the concrete demonstration. The absence of defended_by is meaningful through negation-as-failure, triggering hanging_mine and advice priority 95.");
}

// 11 comparison
{
  const s=p.slides.add(); base(s,11,"SENTIO / HYBRID AI"); title(s,"Each engine owns the job it can do best");
  const headers=[[60,"STOCKFISH",C.green],[460,"PROLOG",C.amber],[860,"LLM COACH",C.purple]];
  headers.forEach(([x,h,c])=>{shape(s,"roundRect",x,200,360,390,C.panel,C.line,"rounded-xl"); text(s,h,x+24,225,310,30,18,c,{bold:true,mono:true});});
  const blocks=[
    [84,285,["Role","Search and evaluation","Output","Best move · score","Strength","Tactical depth","Limit","Hard to narrate directly"]],
    [484,285,["Role","Rules and explanation","Output","Ranked advice","Strength","Transparent logic","Limit","Narrow encoded knowledge"]],
    [884,285,["Role","Dialogue and language","Output","Natural coaching","Strength","Flexible communication","Limit","Needs grounding + fallback"]],
  ];
  blocks.forEach(([x,y,a])=>{for(let i=0;i<a.length;i+=2){text(s,a[i],x,y+(i/2)*70,90,22,12,C.muted,{bold:true,mono:true}); text(s,a[i+1],x,y+24+(i/2)*70,285,30,18,C.ink,{bold:true});}});
  text(s,"Hybrid design turns one opaque ‘AI’ into accountable, composable capabilities.",95,630,1090,34,23,C.cream,{bold:true,align:"center"});
  notes(s,["backend/main.py","prolog/ai_system.pl","app/api/coach/route.ts"],"Avoid claiming that one paradigm is universally superior. The system is robust because responsibilities are explicit.");
}

// 12 agents screenshot
{
  const s=p.slides.add(); base(s,12,"SENTIO / SEARCH LAB"); title(s,"Four agents reveal how evaluation priorities change a search tree");
  await imageOn(s,"sentio-3d.png",60,185,710,430,"cover","Sentio 3D arena and AI decision controls");
  const agents=[["Materialist","1.8× material",C.orange],["Positional","1.8× activity",C.green],["Defender","2.1× king safety",C.blue],["Tactician","deeper forcing lines",C.amber2]];
  agents.forEach((a,i)=>{const y=205+i*86; line(s,820,y+6,6,a[2],42); text(s,a[0],846,y,310,28,21,C.ink,{bold:true}); text(s,a[1],846,y+34,310,26,16,C.muted,{mono:true});});
  text(s,"Same FEN. Different heuristic weights. Selectable Minimax or MCTS traces.",820,565,345,70,20,C.cream,{bold:true});
  notes(s,["lib/agents.ts","lib/minimax.ts","lib/mcts.ts","components/AgentsGraph3D.tsx","Local screenshot: .presentation-build/assets/sentio-3d.png"],"The four agents are an analysis and visualization feature. They expose tradeoffs rather than replacing the production Stockfish opponent.");
}

// 13 coach screenshot
{
  const s=p.slides.add(); base(s,13,"SENTIO / LANGUAGE AI"); title(s,"The coach grounds natural language in the live position");
  await imageOn(s,"sentio-main.png",55,180,730,440,"cover","Sentio AI Coach and Burmese voice coach interface");
  const flow=[["INPUT","FEN · emotion · question",C.cyan],["GROUNDING","legal moves · best move",C.green],["GENERATION","Groq or local LLM",C.purple],["FALLBACK","structured chess advice",C.amber]];
  flow.forEach((r,i)=>{const y=190+i*98; text(s,r[0],835,y,150,24,12,r[2],{bold:true,mono:true}); text(s,r[1],835,y+32,340,38,19,C.ink,{bold:true}); if(i<3) line(s,835,y+77,300,C.line,1);});
  text(s,"The interface can offer a playable move, but chess.js validation remains the authority.",835,590,350,64,18,C.cream,{bold:true});
  notes(s,["app/api/coach/route.ts","lib/coachPrompt.ts","components/AIAnalysisTab.tsx","Local screenshot: .presentation-build/assets/sentio-main.png"],"Explain graceful fallback: the route builds structured advice first, then enhances it with an LLM when available.");
}

// 14 voice
{
  const s=p.slides.add(); base(s,14,"SENTIO / VOICE AI"); title(s,"Burmese voice supports two separate—and safer—interaction paths");
  shape(s,"roundRect",60,205,545,380,C.panel,C.line,"rounded-xl");
  text(s,"VOICE MOVE",90,232,220,26,15,C.cyan,{bold:true,mono:true});
  text(s,"Audio → transcript → parseChessMove() → legal move validation → board",90,286,450,110,27,C.ink,{bold:true});
  text(s,"A command executes only after it resolves to a legal move.",90,470,430,60,19,C.muted);
  shape(s,"roundRect",675,205,545,380,C.panel,C.line,"rounded-xl");
  text(s,"VOICE COACH",705,232,220,26,15,C.purple,{bold:true,mono:true});
  text(s,"Audio → transcript → editable text → /api/coach → Burmese answer → optional TTS",705,286,450,125,27,C.ink,{bold:true});
  text(s,"Asking a question never auto-plays a move.",705,470,430,60,19,C.muted);
  pill(s,"LOCAL WHISPER",155,620,170,C.cyan); pill(s,"GROQ",370,620,110,C.green); pill(s,"ELEVENLABS",650,620,170,C.orange); pill(s,"GEMINI",865,620,120,C.purple); pill(s,"ASSEMBLYAI",1030,620,160,C.blue);
  notes(s,["README.md","app/api/transcribe/route.ts","lib/speechParser.ts","components/VoiceCoachControl.tsx"],"Stress the separation of intent. Speech-to-move is command execution with validation; speech-to-coach is an editable conversational path.");
}

// 15 product
{
  const s=p.slides.add(); base(s,15,"SENTIO / PRODUCT SURFACE"); title(s,"The AI remains visible, controllable, and inspectable during play");
  await imageOn(s,"sentio-analysis.png",45,168,850,480,"cover","Sentio analysis workspace with chessboard and controller");
  const callouts=[["LIVE EVAL","Stockfish score",C.green],["EMOTION TELEMETRY","soft evidence over time",C.cyan],["BOT PROFILE","ELO · depth · skill",C.amber],["AI TABS","coach · logic · analysis",C.purple]];
  callouts.forEach((r,i)=>{const y=180+i*105; text(s,r[0],935,y,260,24,13,r[2],{bold:true,mono:true}); text(s,r[1],935,y+34,260,48,18,C.ink,{bold:true});});
  text(s,"Manual emotion override keeps the human in control.",935,590,280,56,19,C.cream,{bold:true});
  notes(s,["components/BoardWorkspace.tsx","components/ControllerPanel.tsx","components/EmotionMonitor.tsx","Local screenshot: .presentation-build/assets/sentio-analysis.png"],"Show that the adaptive system exposes its current state: emotion, engine profile, evaluation, and analysis tools.");
}

// 16 reliability
{
  const s=p.slides.add(); base(s,16,"SENTIO / RELIABILITY"); title(s,"Graceful degradation keeps the core game available");
  const rows=[
    ["PROLOG UNAVAILABLE","Logician shows setup guidance; game logic is unaffected",C.amber],
    ["LLM UNAVAILABLE","Structured fallback coach still returns position-aware advice",C.purple],
    ["CLOUD STT UNAVAILABLE","Local Whisper or another configured provider can take over",C.cyan],
    ["STOCKFISH BUSY","Bounded engine pool returns an explicit 503 instead of corrupt state",C.green],
    ["STALE UI RESPONSE","Sequence checks ignore obsolete Logician requests",C.orange],
  ];
  rows.forEach((r,i)=>{const y=190+i*86; shape(s,"roundRect",60,y,1160,64,C.panel,C.line,"rounded-lg"); shape(s,"rect",60,y,8,64,r[2]); text(s,r[0],88,y+17,260,26,13,r[2],{bold:true,mono:true}); text(s,r[1],365,y+15,805,34,18,C.ink);});
  text(s,"A robust AI product is defined as much by its boundaries as by its models.",85,640,1110,30,22,C.cream,{bold:true,align:"center"});
  notes(s,["backend/main.py","app/api/prolog/route.ts","app/api/coach/route.ts","app/api/transcribe/route.ts","components/LogicianPanel.tsx"],"This slide is useful for technical evaluation: each optional AI service fails independently and reports a meaningful state.");
}

// 17 team
{
  const s=p.slides.add(); base(s,17,"SENTIO / TEAM HANDOFF"); title(s,"Five presenters can tell one connected AI story");
  const members=[
    ["MEMBER 1","Problem + architecture","Slides 1–4",C.cream],
    ["MEMBER 2","Emotion perception + adaptation","Slides 5–6",C.cyan],
    ["MEMBER 3","Prolog deep dive + bridge","Slides 7–10",C.amber],
    ["MEMBER 4","Hybrid search + agents + coach","Slides 11–13",C.green],
    ["MEMBER 5","Voice + product + reliability + close","Slides 14–18",C.purple],
  ];
  members.forEach((m,i)=>{const y=180+i*92; text(s,m[0],65,y,145,24,13,m[3],{bold:true,mono:true}); text(s,m[1],240,y-3,580,32,24,C.ink,{bold:true}); pill(s,m[2],965,y-2,190,m[3]); if(i<4) line(s,65,y+55,1100,C.line,1);});
  text(s,"Transition phrase",65,642,180,24,13,C.amber,{bold:true,mono:true});
  text(s,"“That layer creates the signal the next layer needs.”",250,638,850,34,22,C.cream,{italic:true});
  notes(s,[".presentation-build/slide-plan.txt"],"Use this ownership split as a rehearsal guide. Member 3 gets the largest technical Prolog sequence, matching the requested emphasis.");
}

// 18 close
{
  const s=p.slides.add(); s.background.fill=C.bg;
  text(s,"SENTIO / SYNTHESIS",60,44,350,24,12,C.amber,{bold:true,mono:true});
  text(s,"One adaptive loop.\nFour forms of intelligence.",60,130,780,130,52,C.ink,{bold:true});
  const items=[["PERCEPTION","reads the player",C.cyan],["SEARCH","reads the board",C.green],["PROLOG","makes rules visible",C.amber],["LANGUAGE","makes guidance usable",C.purple]];
  items.forEach((r,i)=>{const x=62+i*295; line(s,x,340,62,r[2],4); text(s,r[0],x,365,240,24,14,r[2],{bold:true,mono:true}); text(s,r[1],x,410,240,46,22,C.cream,{bold:true});});
  shape(s,"roundRect",840,105,340,170,"#1B1510",C.amber,"rounded-xl");
  text(s,"PROLOG’S BRIDGE",875,135,270,24,14,C.amber2,{bold:true,mono:true,align:"center"});
  text(s,"position state → explicit facts → prioritized explanation",875,182,270,75,23,C.ink,{bold:true,align:"center"});
  text(s,"Sentio demonstrates that trustworthy AI is not one model—it is a well-designed conversation between models, rules, state, and people.",120,550,1040,82,27,C.ink,{bold:true,align:"center"});
  notes(s,["README.md","AI_SYSTEM.txt","prolog/ai_system.pl"],"Close by resolving the opening. Prolog is the bridge that turns machine-readable board state into inspectable human reasoning, inside a broader adaptive loop.");
}

await fs.mkdir(`${BUILD}/rendered`, { recursive: true });
for (const [i, slide] of p.slides.items.entries()) {
  const png = await p.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(`${BUILD}/rendered/slide-${String(i+1).padStart(2,"0")}.png`, new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(`${BUILD}/rendered/slide-${String(i+1).padStart(2,"0")}.layout.json`, await layout.text());
}
const montage = await p.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(`${BUILD}/rendered/montage.webp`, new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(p);
await pptx.save(OUT);
console.log(OUT);
