import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "/Users/yuza/Downloads/Sentio_AI_Project_Charcoal.pptx";
const output = "/Users/yuza/chess-agent-v2/.presentation-build/sentio-charcoal-revision/template-inspect/template-inspect.ndjson";

const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const inspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,bboxUnit,isPlaceholder",
  maxChars: 500000,
});

if (inspect.truncated) throw new Error("Full template inspection was unexpectedly truncated.");
await fs.writeFile(output, inspect.ndjson, "utf8");
