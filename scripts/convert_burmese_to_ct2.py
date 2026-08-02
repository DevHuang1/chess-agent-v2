import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "backend", "models", "whisper-small-burmese-v2")
DST = os.path.join(ROOT, "backend", "models", "whisper-small-burmese-v2-ct2")

safetensors = os.path.join(SRC, "model.safetensors")
if not os.path.exists(safetensors):
    print(f"[convert] MISSING {safetensors}")
    sys.exit(1)

print(f"[convert] source: {SRC} ({os.path.getsize(safetensors)/1e6:.0f} MB)")
print(f"[convert] target: {DST}")

start = time.time()
from ctranslate2.converters import TransformersConverter  # noqa: E402

converter = TransformersConverter(
    SRC,
    copy_files=[
        "added_tokens.json",
        "generation_config.json",
        "merges.txt",
        "normalizer.json",
        "preprocessor_config.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "vocab.json",
    ],
)
converter.convert(output_dir=DST, quantization="int8")
print(f"[convert] DONE in {time.time()-start:.0f}s -> {DST}")
