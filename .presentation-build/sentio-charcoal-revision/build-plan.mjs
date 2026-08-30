import fs from "node:fs/promises";
import path from "node:path";

const root = "/Users/yuza/chess-agent-v2/.presentation-build/sentio-charcoal-revision";
const layoutsDir = path.join(root, "template-inspect", "layouts");

const mapping = [
  [1, 1, "opening title"],
  [2, 2, "team ownership and responsibilities"],
  [3, 3, "presentation roadmap"],
  [4, 13, "What Sentio is and how the product works"],
  [5, 4, "problem and audience need"],
  [6, 5, "system objectives"],
  [7, 6, "functional requirements"],
  [8, 7, "system architecture"],
  [9, 8, "emotion detection method"],
  [10, 9, "emotion to engine adaptation"],
  [11, 10, "Stockfish and Prolog reasoning"],
  [12, 11, "voice coach and voice moves"],
  [13, 12, "implementation example"],
  [14, 13, "real system UI evidence"],
  [15, 14, "benefits and limitations"],
  [16, 15, "future work"],
  [17, 16, "conclusion"],
  [18, 1, "standalone thank you closing"],
];

async function layoutFor(slideNo) {
  const stem = String(slideNo).padStart(2, "0");
  return JSON.parse(await fs.readFile(path.join(layoutsDir, `source-slide-${stem}.layout.json`), "utf8"));
}

const outputSlides = [];
for (const [outputSlide, sourceSlide, narrativeRole] of mapping) {
  const layout = await layoutFor(sourceSlide);
  const editTargets = [];
  for (const el of layout.elements) {
    const hasText = typeof el.text === "string";
    let action = hasText ? "rewrite" : "keep";

    if (hasText && outputSlide >= 4 && outputSlide <= 17) {
      const [, top] = el.bbox ?? [0, 0];
      if (top < 160) action = "rewrite-and-reposition";
    }

    if (sourceSlide === 13 && outputSlide === 4) {
      const [left, top] = el.bbox ?? [0, 0];
      if (top >= 160 && top < 650 && left < 800) action = "delete";
    }

    if (sourceSlide === 13 && outputSlide === 14) {
      const [, top] = el.bbox ?? [0, 0];
      if (top >= 150 && top < 650) action = "delete";
    }

    editTargets.push({ action, shapeId: el.aid });
  }

  if (outputSlide === 4) {
    editTargets.push({
      action: "add",
      newPrimitiveAllowed: true,
      primitive: "real-product-screenshot",
      zone: { left: 59.52, top: 184.32, width: 720, height: 427.2 },
      reason: "Replace the inherited pseudo UI with an authentic Sentio Analysis screenshot.",
      mustNotOverlapInherited: true,
    });
  }

  if (outputSlide === 14) {
    editTargets.push({
      action: "add",
      newPrimitiveAllowed: true,
      primitive: "real-product-screenshot-collage",
      zone: { left: 59.52, top: 165, width: 1160.93, height: 470 },
      reason: "Use three authentic Sentio screenshots as the system UI evidence requested by the user.",
      mustNotOverlapInherited: true,
    });
  }

  outputSlides.push({
    outputSlide,
    sourceSlide,
    narrativeRole,
    reuseMode: "duplicate-slide",
    editTargets,
  });
}

const used = new Set(mapping.map(([, sourceSlide]) => sourceSlide));
const omittedSourceSlides = [];
for (let slide = 1; slide <= 16; slide += 1) {
  if (!used.has(slide)) omittedSourceSlides.push({ sourceSlide: slide, reason: "No source slide omitted; retained for completeness." });
}

await fs.writeFile(
  path.join(root, "template-frame-map.json"),
  `${JSON.stringify({ outputSlides, omittedSourceSlides }, null, 2)}\n`,
);

await fs.writeFile(
  path.join(root, "template-audit.txt"),
  [
    "Source: Sentio_AI_Project_Charcoal.pptx (16 slides, 1280x720).",
    "Template: charcoal background, ember-orange accent, white Cambria titles, Calibri body copy.",
    "Insertion contract: duplicate every output slide from a source slide; edit inherited objects in place.",
    "New slides: What is Sentio? follows Contents and duplicates source slide 13; Thank You duplicates source slide 1.",
    "System UI: replace the illustrative interface with real locally captured Sentio screenshots.",
    "Typography: preserve families and hierarchy while increasing contrast to warm white/cream.",
    "No structural placeholders were reported in the source layouts.",
  ].join("\n") + "\n",
);

await fs.writeFile(
  path.join(root, "deviation-log.txt"),
  [
    "Slide 2: team responsibility text updated from placeholders using the user's ownership details.",
    "Slide 3: contents rewritten to match the revised narrative.",
    "Slide 4: source slide 13 repurposed for a concise product definition and authentic Analysis screenshot.",
    "Slide 14: inherited pseudo UI removed and replaced by three authentic product screenshots.",
    "Slide 18: source title slide repurposed as a dedicated thank-you slide.",
    "All slides: low-contrast body copy brightened while retaining the charcoal/ember palette.",
  ].join("\n") + "\n",
);

await fs.writeFile(
  path.join(root, "source-notes.txt"),
  [
    "All product claims are based on the local Sentio repository (README.md, AI_SYSTEM.txt, backend/main.py, prolog/ai_system.pl, and current UI code).",
    "Screenshots are local captures from the running Sentio project: sentio-analysis.png, sentio-main.png, sentio-logician.png, and sentio-3d.png.",
    "Team responsibility wording comes directly from the user's message in this task.",
    "No external assets or external non-trivial claims were added.",
  ].join("\n") + "\n",
);
