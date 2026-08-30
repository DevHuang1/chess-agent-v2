import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const root = "/Users/yuza/chess-agent-v2/.presentation-build/sentio-charcoal-revision";
const source = `${root}/template-starter.pptx`;
const output = "/Users/yuza/chess-agent-v2/Sentio_AI_Project_Charcoal_Revised.pptx";
const renderDir = `${root}/final-render`;
const layoutDir = `${root}/final-layout/final`;

const screenshotPaths = {
  analysis: "/Users/yuza/chess-agent-v2/.presentation-build/assets/sentio-analysis.png",
  main: "/Users/yuza/chess-agent-v2/.presentation-build/assets/sentio-main.png",
  logician: "/Users/yuza/chess-agent-v2/.presentation-build/assets/sentio-logician.png",
  arena3d: "/Users/yuza/chess-agent-v2/.presentation-build/assets/sentio-3d.png",
};

async function bytes(file) {
  const data = await fs.readFile(file);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function shapeText(shape) {
  return String(shape.text ?? "").trim();
}

function pos(shape) {
  return {
    left: Number(shape.position?.left ?? 0),
    top: Number(shape.position?.top ?? 0),
    width: Number(shape.position?.width ?? 0),
    height: Number(shape.position?.height ?? 0),
  };
}

function textShapes(slide) {
  return slide.shapes.items.filter((shape) => shapeText(shape).length > 0);
}

function exact(slide, text, occurrence = 0) {
  const matches = textShapes(slide).filter((shape) => shapeText(shape) === text);
  if (!matches[occurrence]) {
    throw new Error(`Text not found on slide ${slide.index + 1}: ${text} [${occurrence}]`);
  }
  return matches[occurrence];
}

function setCopy(slide, oldText, newText, options = {}, occurrence = 0) {
  const shape = exact(slide, oldText, occurrence);
  shape.text = newText;
  if (options.color) shape.text.color = options.color;
  if (options.fontSize) shape.text.fontSize = options.fontSize;
  const style = {};
  if (options.bold !== undefined) style.bold = options.bold;
  if (options.typeface) style.typeface = options.typeface;
  if (Object.keys(style).length > 0) shape.text.style = style;
  return shape;
}

function setTitle(slide, oldText, newText) {
  return setCopy(slide, oldText, newText, { color: "#FFFFFF" });
}

function setHierarchy(slide, oldSectionText, oldTitleText, mainTitle, subtitle, subtitleFontSize = 18.67) {
  const title = exact(slide, oldTitleText);
  title.text = mainTitle;
  title.position = { left: 59.52, top: 70, width: 1160.93, height: 58 };
  title.text.color = "#FFFFFF";
  title.text.fontSize = 41.33;

  const secondary = exact(slide, oldSectionText);
  secondary.text = subtitle;
  secondary.position = { left: 59.52, top: 132, width: 1160.93, height: 28 };
  secondary.text.style = {
    fontSize: subtitleFontSize,
    bold: true,
    color: "#FFC24B",
    typeface: "Calibri",
    alignment: "left",
    verticalAlignment: "middle",
    wrap: "none",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return { title, secondary };
}

function addLabel(slide, text, position) {
  const label = slide.shapes.add({
    geometry: "textbox",
    name: `ui-label-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  label.text = text;
  label.text.style = {
    fontSize: 16,
    bold: true,
    color: "#FFC24B",
    typeface: "Calibri",
    alignment: "left",
    verticalAlignment: "middle",
    wrap: "none",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return label;
}

function removeRegion(slide, predicate) {
  for (const shape of [...slide.shapes.items]) {
    const box = pos(shape);
    if (predicate(box, shape)) shape.delete();
  }
}

function brightenSlide(slide, slideNumber) {
  const protectedDark = new Set([
    "BROWSER",
    "NEXT.JS SERVER",
    "PYTHON BACKEND",
    "BENEFITS",
    "LIMITATIONS",
    "AI COACH",
    "focused",
  ]);

  for (const shape of textShapes(slide)) {
    const text = shapeText(shape);
    const box = pos(shape);
    if (box.top > 650 && /^\d{1,2}$/.test(text)) {
      shape.text = String(slideNumber);
      shape.text.color = "#FFC24B";
      continue;
    }
    if (protectedDark.has(text)) continue;
    if (text.length <= 2 && box.top < 640) continue;
    if (box.top < 90 && text === text.toUpperCase() && text.length > 3) {
      shape.text.color = "#FFC24B";
    } else if (box.top > 650) {
      shape.text.color = "#E3DFD7";
    } else {
      shape.text.color = "#F7F4EE";
    }
  }
}

function notes(slide, lines) {
  slide.speakerNotes.textFrame.setText([
    "[Sources]",
    ...lines.map((line) => `- ${line}`),
    "[/Sources]",
  ]);
}

const deck = await PresentationFile.importPptx(await FileBlob.load(source));

// Slide 1 — opening title.
{
  const slide = deck.slides.getItem(0);
  setCopy(slide, "Latin for \"I feel\" — a chess engine that reads your emotions and adapts in real time.", "An emotion-aware chess system that adapts difficulty, explains positions, and supports Burmese voice interaction.", { color: "#F7F4EE" });
  notes(slide, [
    "/Users/yuza/chess-agent-v2/README.md",
    "/Users/yuza/chess-agent-v2/AI_SYSTEM.txt",
  ]);
}

// Slide 4 — What is Sentio? with a real UI screenshot.
{
  const slide = deck.slides.getItem(3);
  removeRegion(slide, ({ left, top }) => top >= 160 && top < 650 && left < 800);
  setHierarchy(slide, "THE INTERFACE IN USE", "System UI", "What is Sentio?", "The project in one slide");

  const headers = ["Interactive board", "Emotion monitor", "Evaluation bar", "Tabbed panel"];
  const newHeaders = ["Emotion-aware chess", "Adaptive Stockfish", "Explainable coaching", "Voice + 3D interaction"];
  const bodies = [
    "Legal-move highlighting, promotion picker and undo.",
    "Shows the detected state and the engine profile in use.",
    "Live engine assessment beside the board.",
    "Coach, Logician, Speech, Benchmark and Training.",
  ];
  const newBodies = [
    "A full-stack chess app that senses the player's state while the game is running.",
    "Emotion changes engine depth, skill level, and ELO automatically.",
    "Prolog gives traceable rule-based advice; the LLM provides separate natural-language coaching.",
    "Burmese voice moves, voice coaching, and a hand-tracked 3D arena.",
  ];
  for (let i = 0; i < headers.length; i += 1) {
    setCopy(slide, headers[i], newHeaders[i], { color: "#FFFFFF", fontSize: 18.67, bold: true });
    setCopy(slide, bodies[i], newBodies[i], { color: "#F7F4EE", fontSize: 15.6 });
  }

  slide.images.add({
    blob: await bytes(screenshotPaths.analysis),
    contentType: "image/png",
    alt: "Real Sentio analysis workspace showing the chessboard and AI analysis panel",
    fit: "contain",
    geometry: "roundRect",
    borderRadius: 12,
    position: { left: 59.52, top: 184.32, width: 720, height: 405 },
  });
  notes(slide, [
    "/Users/yuza/chess-agent-v2/README.md",
    "/Users/yuza/chess-agent-v2/AI_SYSTEM.txt",
    screenshotPaths.analysis,
  ]);
}

// Slide 2 — team ownership.
{
  const slide = deck.slides.getItem(1);
  const roleIds = textShapes(slide).filter((shape) => shapeText(shape) === "TNT - 0000");
  const footerRoles = textShapes(slide).filter((shape) => shapeText(shape) === "Presenter");
  const replacements = [
    ["Member Name 1", "Member 1", "System development\nEmotion detection module", "Architecture · frontend · backend/API\nEmotion AI · Stockfish · Prolog\nVoice features · 3D integration"],
    ["Member Name 2", "Member 2", "Backend development\nStockfish integration", "Voice coach idea\nBurmese coaching concept"],
    ["Member Name 3", "Member 3", "Prolog knowledge base\nLogician panel", "Voice-command idea\nSpoken move concept"],
    ["Member Name 4", "Member 4", "Frontend UI · voice module\nDocumentation", "3D hand-tracking design\nInteraction · UI feature"],
  ];
  for (let i = 0; i < replacements.length; i += 1) {
    const [oldName, newName, oldBody, newBody] = replacements[i];
    setCopy(slide, oldName, newName, { color: "#FFFFFF", fontSize: 20, bold: true });
    setCopy(slide, oldBody, newBody, { color: "#F7F4EE", fontSize: i === 0 ? 14.8 : 16 });
    roleIds[i].text = i === 0 ? "TEAM LEADER" : "CONTRIBUTOR";
    roleIds[i].text.color = "#FFC24B";
    roleIds[i].text.fontSize = 14;
    footerRoles[i].text = i === 0 ? "Full-System Developer" : "Feature Support";
    footerRoles[i].text.color = i === 0 ? "#FFC24B" : "#F7F4EE";
  }
  setCopy(
    slide,
    "Replace the placeholder names and roll numbers before presenting.",
    "Member 1 built every system layer; Members 2–4 supported the listed concepts and interaction design.",
    { color: "#F7F4EE", fontSize: 15.2 },
  );
  notes(slide, ["Team responsibility details supplied by the user in this task."]);
}

// Slide 3 — clearer contents.
{
  const slide = deck.slides.getItem(2);
  const oldItems = [
    "Problem Statement",
    "System Objectives",
    "Functional Requirements",
    "System Architecture",
    "Methodology",
    "Code Example",
    "System UI",
    "Benefits & Limitations",
    "Future Work",
    "Conclusion & References",
  ];
  const newItems = [
    "Problem Statement",
    "System Objectives",
    "Functional Requirements",
    "System Architecture",
    "Methodology",
    "Code Example",
    "System UI",
    "Benefits & Limitations",
    "Future Work",
    "Conclusion & References",
  ];
  oldItems.forEach((item, index) => setCopy(slide, item, newItems[index], { color: "#F7F4EE", fontSize: 18.67, bold: true }));
  notes(slide, ["Revised narrative structure for this presentation."]);
}

// Slides 5–13 — direct takeaway titles and concise copy.
{
  const slide = deck.slides.getItem(4);
  setHierarchy(slide, "WHY THIS PROJECT EXISTS", "Problem Statement", "Problem Statement", "Why Sentio is needed");
  setCopy(slide, "Engines play at one strength, chosen manually before the game starts, and it never changes.", "One fixed setting cannot match a player's changing focus, stress, or confidence.", { color: "#F7F4EE" });
  setCopy(slide, "Weak players get crushed and lose motivation; strong players get bored at the same setting.", "Beginners lose motivation when every game feels impossible; stronger players stop being challenged.", { color: "#F7F4EE" });
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/AI_SYSTEM.txt"]);
}
{
  const slide = deck.slides.getItem(5);
  setHierarchy(slide, "WHAT WE SET OUT TO BUILD", "System Objectives", "System Objectives", "What Sentio must deliver");
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/AI_SYSTEM.txt"]);
}
{
  const slide = deck.slides.getItem(6);
  setHierarchy(slide, "WHAT THE SYSTEM MUST DO", "Functional Requirements", "Functional Requirements", "Core system requirements");
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/app/page.tsx"]);
}
{
  const slide = deck.slides.getItem(7);
  setHierarchy(slide, "HOW THE PIECES FIT TOGETHER", "System Architecture & Stack", "System Architecture", "How Sentio connects every AI layer");
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/backend/main.py"]);
}
{
  const slide = deck.slides.getItem(8);
  setHierarchy(slide, "HOW THE SYSTEM READS THE PLAYER", "Methodology 1 — Emotion Detection", "Methodology", "Stable emotion detection");
  notes(slide, ["/Users/yuza/chess-agent-v2/app/page.tsx", "/Users/yuza/chess-agent-v2/lib/blendshapeEmotion.ts"]);
}
{
  const slide = deck.slides.getItem(9);
  setHierarchy(slide, "THE CORE OF THE SYSTEM", "Methodology 2 — Emotion to Engine Mapping", "Methodology", "Emotion changes Stockfish strength");
  notes(slide, ["/Users/yuza/chess-agent-v2/lib/engineProfiles.ts", "/Users/yuza/chess-agent-v2/prolog/ai_system.pl"]);
}
{
  const slide = deck.slides.getItem(10);
  setHierarchy(slide, "MOVE GENERATION AND EXPLAINABLE ADVICE", "Methodology 3 — Stockfish & The Logician", "Methodology", "Stockfish moves; Prolog explains");
  setCopy(slide, "Every conclusion traces back to the exact rule that produced it — the advice is explainable, not a black box.", "Stockfish searches for strong moves. Prolog reads the same position and returns rule-based advice that can be traced and explained.", { color: "#F7F4EE", fontSize: 16 });
  notes(slide, ["/Users/yuza/chess-agent-v2/backend/main.py", "/Users/yuza/chess-agent-v2/prolog/ai_system.pl", "/Users/yuza/chess-agent-v2/app/api/prolog/route.ts"]);
}
{
  const slide = deck.slides.getItem(11);
  setHierarchy(slide, "TALKING WITH THE ENGINE", "Methodology 4 — Coach & Burmese Voice", "Methodology", "Two voice paths: move or ask");
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/lib/speechParser.ts", "/Users/yuza/chess-agent-v2/components/VoiceCoachControl.tsx"]);
}
{
  const slide = deck.slides.getItem(12);
  setHierarchy(slide, "THE MAPPING, IN TWO LANGUAGES", "Code Example", "Code Example", "One emotion profile, two implementations");
  notes(slide, ["/Users/yuza/chess-agent-v2/lib/engineProfiles.ts", "/Users/yuza/chess-agent-v2/prolog/ai_system.pl"]);
}

// Slide 14 — authentic system UI collage.
{
  const slide = deck.slides.getItem(13);
  removeRegion(slide, ({ top }) => top >= 150 && top < 650);
  setHierarchy(slide, "THE INTERFACE IN USE", "System UI", "System UI", "Real Sentio UI — game, reasoning, and 3D control", 18);

  addLabel(slide, "LIVE GAME + COACHING", { left: 59.52, top: 166, width: 360, height: 22 });
  addLabel(slide, "PROLOG LOGICIAN", { left: 830, top: 166, width: 300, height: 22 });
  addLabel(slide, "3D HAND-TRACKED ARENA", { left: 830, top: 399, width: 340, height: 22 });

  slide.images.add({
    blob: await bytes(screenshotPaths.main),
    contentType: "image/png",
    alt: "Real Sentio main workspace with chessboard, emotion state, and coach panel",
    fit: "contain",
    geometry: "roundRect",
    borderRadius: 10,
    position: { left: 59.52, top: 190, width: 742, height: 397 },
  });
  slide.images.add({
    blob: await bytes(screenshotPaths.logician),
    contentType: "image/png",
    alt: "Real Sentio Logician panel showing Prolog-based advice",
    fit: "contain",
    geometry: "roundRect",
    borderRadius: 10,
    position: { left: 830, top: 190, width: 390, height: 190 },
  });
  slide.images.add({
    blob: await bytes(screenshotPaths.arena3d),
    contentType: "image/png",
    alt: "Real Sentio 3D arena with hand-tracking controls",
    fit: "contain",
    geometry: "roundRect",
    borderRadius: 10,
    position: { left: 830, top: 423, width: 390, height: 190 },
  });
  notes(slide, [screenshotPaths.main, screenshotPaths.logician, screenshotPaths.arena3d]);
}

// Slides 15–17 — sharper ending.
{
  const slide = deck.slides.getItem(14);
  setHierarchy(slide, "AN HONEST ASSESSMENT", "Benefits & Limitations", "Benefits & Limitations", "Benefits — and honest limits");
  setCopy(slide, "Prolog shows why a move is suggested, not just that it is.", "Prolog shows why a chess principle applies to the current position.", { color: "#F7F4EE", fontSize: 16 });
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/AI_SYSTEM.txt"]);
}
{
  const slide = deck.slides.getItem(15);
  setHierarchy(slide, "WHERE IT GOES NEXT", "Future Work", "Future Work", "What comes next");
  notes(slide, ["Project roadmap summarized from the current deck and repository scope."]);
}
{
  const slide = deck.slides.getItem(16);
  setHierarchy(slide, "CONCLUSION", "Three kinds of AI, one chessboard", "Conclusion & References", "Sentio brings four AI experiences together");
  const oldLines = [
    "Computer vision reads the player's emotional state in real time.",
    "Symbolic reasoning explains every piece of advice through Prolog.",
    "Language models turn a raw position into usable coaching.",
    "Burmese support removes the language barrier for local players.",
  ];
  const newLines = [
    "Computer vision senses the player's current state.",
    "Stockfish adapts difficulty automatically.",
    "Prolog explains rules; the LLM provides natural-language coaching.",
    "Burmese voice and 3D hand tracking expand how players interact.",
  ];
  oldLines.forEach((line, index) => setCopy(slide, line, newLines[index], { color: "#F7F4EE", fontSize: 18.67 }));
  setCopy(slide, "Thank you — questions are welcome.", "One connected system: adaptive, explainable, multilingual, and playable.", { color: "#FFC24B", fontSize: 18.67, bold: true });
  notes(slide, ["/Users/yuza/chess-agent-v2/README.md", "/Users/yuza/chess-agent-v2/components/Simulation3D.tsx", "/Users/yuza/chess-agent-v2/prolog/ai_system.pl"]);
}

// Slide 18 — dedicated thank-you slide.
{
  const slide = deck.slides.getItem(17);
  const titleSentio = textShapes(slide).filter((shape) => shapeText(shape) === "SENTIO").sort((a, b) => pos(a).top - pos(b).top)[0];
  titleSentio.text = "THANK YOU";
  titleSentio.text.color = "#FFFFFF";
  setCopy(slide, "AI PROJECT  ·  2026", "GROUP-X  ·  SECTION-C", { color: "#FFC24B" });
  setCopy(slide, "An Emotion-Adaptive Chess AI Agent", "Questions & Discussion", { color: "#FFC24B", fontSize: 28, bold: true });
  setCopy(slide, "Latin for \"I feel\" — a chess engine that reads your emotions and adapts in real time.", "Sentio — Emotion-Adaptive Chess AI", { color: "#F7F4EE", fontSize: 18.67 });
  setCopy(slide, "Presented by  Group-X   ·   Section-C", "Built and presented by Group-X · Section-C", { color: "#F7F4EE" });
  notes(slide, ["Closing slide; no external claims or assets added."]);
}

for (let i = 0; i < deck.slides.items.length; i += 1) {
  brightenSlide(deck.slides.getItem(i), i + 1);
}

await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });
for (let i = 0; i < deck.slides.items.length; i += 1) {
  const slide = deck.slides.getItem(i);
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  const png = await deck.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(`${renderDir}/${stem}.png`, new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(`${layoutDir}/${stem}.layout.json`, await layout.text());
}
const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(`${renderDir}/montage.webp`, new Uint8Array(await montage.arrayBuffer()));

const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(output);
console.log(output);
