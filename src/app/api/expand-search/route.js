
import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Keep exactly the same model list as your chat route.
const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "AI service is not configured" },
        { status: 500, headers: corsHeaders }
      );
    }

    const { query } = await req.json();

    if (typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const originalQuery = query.trim();

    const prompt = `
You are an Islamic search query expansion assistant.

The user wants to search Quran and Hadith databases.

Original query: "${originalQuery}"

Generate 3 to 5 alternative search terms that can help find
relevant Quran verses and Hadith.

Consider:
- Roman Urdu and Urdu transliteration.
- Arabic terms and their common transliterations.
- Common spelling mistakes and spelling variations.
- English translations of the original term.
- Closely related Islamic terminology when genuinely relevant.

Do not generate unrelated terms, complete questions, or explanations.
Do not repeat the original query.

Return ONLY valid JSON:
{
  "queries": ["term 1", "term 2", "term 3"]
}
`;

    let data = null;
    let lastErrorStatus = 503;

    for (const model of GEMINI_MODELS) {
      try {
        const response = await fetch(
          \`https://generativelanguage.googleapis.com/v1beta/models/\${model}:generateContent\`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": GEMINI_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: prompt }],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 250,
                responseMimeType: "application/json",
              },
            }),
          }
        );

        if (response.ok) {
          data = await response.json();
          break;
        }

        lastErrorStatus = response.status;

        if (![404, 429, 500, 502, 503, 504].includes(response.status)) {
          break;
        }
      } catch (error) {
        console.error(`Gemini model ${model} failed:`, error);
      }
    }

    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!rawText) {
      return NextResponse.json(
        { queries: [originalQuery] },
        { headers: corsHeaders }
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { queries: [originalQuery] },
        { headers: corsHeaders }
      );
    }

    const alternatives = Array.isArray(parsed.queries)
      ? parsed.queries.filter(
          (item) =>
            typeof item === "string" &&
            item.trim() &&
            item.length <= 100
        )
      : [];

    const queries = [
      ...new Map(
        [originalQuery, ...alternatives].map((item) => [
          item.toLowerCase(),
          item.trim(),
        ])
      ).values(),
    ].slice(0, 6);

    return NextResponse.json(
      { queries },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Search expansion error:", error);

    return NextResponse.json(
      { error: "Failed to expand search query" },
      { status: 500, headers: corsHeaders }
    );
  }
}
