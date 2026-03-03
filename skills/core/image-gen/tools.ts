import OpenAI from "openai";
import { pushPendingImage } from "../../../runtime/src/pending-images.js";

export function registerImageGenTools(registry: {
  register(tool: any): void;
}): void {
  const openaiKey = process.env.OPENAI_API_KEY;

  registry.register({
    name: "generate_image",
    description:
      "Generate an image from a text prompt using DALL-E. Returns the image which will be sent to the user automatically. Use when the user asks to create, draw, or generate an image/picture/visual.",
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
          enum: ["1024x1024", "1024x1792", "1792x1024"],
          description:
            "Image dimensions. Square (1024x1024) is default. Use 1024x1792 for portrait, 1792x1024 for landscape.",
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
        (params.size as "1024x1024" | "1024x1792" | "1792x1024") || "1024x1024";

      console.log(`🎨 Generating image: "${prompt.slice(0, 80)}..."`);

      const response = await client.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
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
        revisedPrompt: imageData.revised_prompt || prompt,
        size,
        delivered: true, // Image queued for delivery to user
      };
    },
  });
}
