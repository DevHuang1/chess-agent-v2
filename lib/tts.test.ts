import { describe, expect, it } from "vitest";
import {
  normalizeTtsLanguage,
  synthesizeAzureTts,
  synthesizeEdgeBackendTts,
  synthesizeElevenLabsTts,
  validateTtsInput,
  type FetchLike,
} from "./tts";

const audioBuffer = (bytes: number[]) => new Uint8Array(bytes).buffer;

const makeResponse = (ok: boolean, status: number, bytes: number[]) => ({
  ok,
  status,
  arrayBuffer: () => Promise.resolve(audioBuffer(bytes)),
});

const makeFetch = (status: number, ok: boolean, bytes: number[]): FetchLike => {
  return async () => makeResponse(ok, status, bytes);
};

describe("validateTtsInput", () => {
  it("rejects missing text", () => {
    const result = validateTtsInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects empty text", () => {
    expect(validateTtsInput({ text: "   " }).ok).toBe(false);
  });

  it("rejects unsupported languages", () => {
    const result = validateTtsInput({ text: "x", language: "zh-CN" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("accepts Burmese and tolerates shorthand language tags", () => {
    const my = validateTtsInput({ text: "မင်္ဂလာပါ", language: "my" });
    expect(my.ok).toBe(true);
    if (my.ok) expect(my.language).toBe("my-MM");

    expect(normalizeTtsLanguage("my_MM")).toBe("my-MM");
    expect(normalizeTtsLanguage("en-us")).toBe("en-US");
  });

  it("rejects oversized text", () => {
    const result = validateTtsInput({ text: "a".repeat(2001) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });
});

describe("synthesizeElevenLabsTts", () => {
  const params = {
    text: "မင်္ဂလာပါ",
    voice: "voice-1",
    apiKey: "secret-key",
    model: "eleven_multilingual_v2",
  };

  it("returns audio bytes when the provider succeeds", async () => {
    const result = await synthesizeElevenLabsTts(params, makeFetch(200, true, [
      12, 13, 14, 255,
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/mpeg");
      expect(Array.from(result.audioBytes)).toEqual([12, 13, 14, 255]);
    }
  });

  it("posts to the elevenlabs TTS endpoint with the api key header", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    const mockFetch: FetchLike = async (u, init) => {
      url = u;
      headers = init.headers;
      return makeResponse(true, 200, [1]);
    };
    await synthesizeElevenLabsTts(params, mockFetch);
    expect(url).toContain("/v1/text-to-speech/voice-1");
    expect(headers["xi-api-key"]).toBe("secret-key");
  });

  it("returns a safe, non-sensitive error when the provider fails", async () => {
    const result = await synthesizeElevenLabsTts(params, makeFetch(500, false, [
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.detail).not.toContain("secret");
    }
  });

  it("surfaces a clear message when the key lacks text_to_speech permission", async () => {
    const result = await synthesizeElevenLabsTts(params, makeFetch(401, false, []));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.detail.toLowerCase()).toContain("text_to_speech permission");
    }
  });

  it("surfaces a clear message on quota or billing failures", async () => {
    for (const status of [402, 429]) {
      const result = await synthesizeElevenLabsTts(
        params,
        makeFetch(status, false, []),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail.toLowerCase()).toContain("quota");
    }
  });

  it("returns a timeout error when the provider hangs", async () => {
    const err = new Error("network");
    err.name = "TimeoutError";
    const mockFetch: FetchLike = async () => {
      throw err;
    };
    const result = await synthesizeElevenLabsTts(params, mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("timed out");
  });
});

describe("synthesizeEdgeBackendTts", () => {
  const edgeParams = {
    text: "မင်္ဂလာပါ",
    language: "my-MM",
    backendUrl: "http://localhost:8000/tts",
  };

  it("posts JSON to the local bridge and returns audio bytes", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    let body = "";
    const mockFetch: FetchLike = async (u, init) => {
      url = u;
      headers = init.headers;
      body = init.body;
      return makeResponse(true, 200, [7, 8, 9]);
    };
    const result = await synthesizeEdgeBackendTts(edgeParams, mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("audio/mpeg");
      expect(Array.from(result.audioBytes)).toEqual([7, 8, 9]);
    }
    expect(url).toBe("http://localhost:8000/tts");
    expect(headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(body);
    expect(parsed.text).toBe("မင်္ဂလာပါ");
    expect(parsed.language).toBe("my-MM");
  });

  it("maps backend errors to a safe failure without falling over", async () => {
    const result = await synthesizeEdgeBackendTts(
      edgeParams,
      makeFetch(503, false, []),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.detail).toContain("(503)");
    }
  });

  it("reports an unavailable backend on network failure", async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await synthesizeEdgeBackendTts(edgeParams, mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.detail).toContain("unavailable");
    }
  });

  it("reports timeouts distinctly", async () => {
    const err = new Error("hang");
    err.name = "TimeoutError";
    const mockFetch: FetchLike = async () => {
      throw err;
    };
    const result = await synthesizeEdgeBackendTts(edgeParams, mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("timed out");
  });

  it("rejects empty audio responses", async () => {
    const result = await synthesizeEdgeBackendTts(
      edgeParams,
      makeFetch(200, true, []),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("empty audio");
  });
});

describe("synthesizeAzureTts", () => {
  const azureParams = {
    text: "မင်္ဂလာပါ",
    language: "my-MM",
    apiKey: "azure-key",
    region: "southeastasia",
  };

  it("posts SSML to the Azure endpoint with the Burmese neural voice", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    let body = "";
    const mockFetch: FetchLike = async (u, init) => {
      url = u;
      headers = init.headers;
      body = init.body;
      return makeResponse(true, 200, [1, 2]);
    };
    const result = await synthesizeAzureTts(azureParams, mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentType).toBe("audio/mpeg");
    expect(url).toContain("southeastasia.tts.speech.microsoft.com");
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("azure-key");
    expect(headers["Content-Type"]).toBe("application/ssml+xml");
    expect(body).toContain('xml:lang="my-MM"');
    expect(body).toContain("my-MM-NilarNeural");
  });

  it("escapes XML-special characters in the text", async () => {
    let body = "";
    const mockFetch: FetchLike = async (_u, init) => {
      body = init.body;
      return makeResponse(true, 200, [1]);
    };
    await synthesizeAzureTts({ ...azureParams, text: 'a<b>&"c"' }, mockFetch);
    expect(body).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(body).not.toContain("<b>");
  });

  it("returns a clear error when Azure credentials are rejected", async () => {
    const result = await synthesizeAzureTts(
      azureParams,
      makeFetch(401, false, []),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail.toLowerCase()).toContain("authorized");
      expect(result.detail).not.toContain("azure-key");
    }
  });
});