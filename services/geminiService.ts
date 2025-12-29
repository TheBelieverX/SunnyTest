import { GoogleGenAI } from "@google/genai";

/**
 * Generate illustration from description
 * Uses Gemini 2.5 Flash to generate actual children's book illustrations
 * Maintains consistency with session context
 */
export async function generateIllustration(description: string, sessionContext?: string): Promise<string> {
  if (!import.meta.env.VITE_API_KEY) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
  
  // Build a style guide with session context for consistency
  let stylePrompt = `
    Create a colorful, children's book illustration (digital art style) based on this description: "${description}".
    The style should be friendly, soft, and suitable for a 7-year-old. 
    Use vibrant but pleasing colors. 
    High quality, detailed but not cluttered.
  `;

  // If we have session context, add consistency instructions
  if (sessionContext && sessionContext.trim().length > 0) {
    stylePrompt += `

IMPORTANT - MAINTAIN CONSISTENCY WITH THE STORY:
${sessionContext}

When generating this image, please ensure:
- Any characters that appeared before maintain the same appearance (hair color, clothing, etc.)
- The setting/background should be consistent with previously described locations
- Only change details if the description explicitly mentions a change
- Keep the magical/fantastical tone consistent throughout the story
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { text: stylePrompt }
        ]
      }
    });

    console.log('🎨 Gemini Response:', JSON.stringify(response, null, 2));

    // Check parts for inline data
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) throw new Error("No content generated");

    for (const part of parts) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        return `data:image/png;base64,${base64EncodeString}`;
      }
    }
    
    throw new Error("No image data found in response");

  } catch (error) {
    console.error("Image generation failed:", error);
    throw error;
  }
}