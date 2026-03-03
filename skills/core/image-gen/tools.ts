import OpenAI from "openai";
import { pushPendingImage } from "../../../runtime/src/pending-images.js";

export function registerImageGenTools(registry: {
  register(tool: any): void;
}): void {
  const openaiKey = process.env.OPENAI_API_KEY;

  registry.register({
    name: "generate_image",
    description:
      "Generate an image from a text prompt using GPT Image. Returns the image which will be sent to the user automatically. Use when the user asks to create, draw, or generate an image/picture/visual.",
    category: "media",
    parametersSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image to generate. Be specific about style, colors, composition.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1024x1536", "1536x1024"],
          description:
            "Image dimensions. Square (1024x1024) is default. Use 1024x1536 for portrait, 1536x1024 for landscape.",
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high", "auto"],
          description:
            "Image quality. 'auto' is default. 'high' for best quality, 'low' for fastest generation.",
        },
      },
      required: ["prompt"],
    },
    permissions: [],
    execute: async (params: any) => {
      const prompt = String(params.prompt || "");
      if (!prompt) throw new Error("Prompt is required");

      if (!openaiKey) {
        throw new Error(
          "OPENAI_API_KEY is not configured. Image generation requires an OpenAI API key.",
        );
      }

      const client = new OpenAI({ apiKey: openaiKey });
      const size =
        (params.size as "1024x1024" | "1024x1536" | "1536x1024") || "1024x1024";
      const quality =
        (params.quality as "low" | "medium" | "high" | "auto") || "auto";

      console.log(`🎨 Generating image: "${prompt.slice(0, 80)}..."`);

      const response = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size,
        quality,
      });

      const imageData = response.data?.[0];
      if (!imageData?.b64_json) {
        throw new Error("Image generation failed — no data returned");
      }

      // Queue the image for Telegram delivery (no caption — just the image)
      pushPendingImage({
        imageBase64: imageData.b64_json,
      });

      return {
        success: true,
        size,
        quality,
        delivered: true, // Image queued for delivery to user
      };
    },
  });
}
