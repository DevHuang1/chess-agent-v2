import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const deck = await PresentationFile.importPptx(
  await FileBlob.load("/Users/yuza/chess-agent-v2/.presentation-build/sentio-charcoal-revision/template-starter.pptx"),
);
const slide = deck.slides.getItem(1);
console.log("slides", deck.slides.items.length, "shapes", slide.shapes.items.length, "images", slide.images.items.length);
for (const shape of slide.shapes.items.slice(0, 8)) {
  console.log({
    id: shape.id,
    name: shape.name,
    position: shape.position,
    hasText: Boolean(shape.text),
    textType: typeof shape.text,
    textValue: shape.text?.text,
    textString: shape.text ? String(shape.text) : "",
    keys: Object.keys(shape).slice(0, 20),
  });
}
