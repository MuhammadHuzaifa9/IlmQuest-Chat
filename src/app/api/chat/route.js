
import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Primary model first, followed by alternative text-generation models.
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
      console.error("GEMINI_API_KEY is missing");

      return NextResponse.json(
        { error: "AI service is not configured" },
        { status: 500, headers: corsHeaders }
      );
    }

    const { question, history = [] } = await req.json();

    if (!question) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // System prompt
    const systemPrompt = `
You are an expert Islamic Q&A Assistant named Ilmquest.
Answer questions based on the Quran, Hadith, and Islamic scholarship.
Be concise, accurate, and respectful.

At the end of your answer, provide 3 short suggested follow-up questions that a user might ask next.
Format them as a JSON array under "suggested_followups".
`;

    // Build conversation history
    const messages = [
      ...(Array.isArray(history) ? history : [])
        .slice(-10)
        .map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      {
        role: "user",
        parts: [{ text: question }],
      },
    ];

    // Automatically try alternative Gemini models
    let data = null;
    let successfulModel = null;
    let lastErrorStatus = 503;

    for (const model of GEMINI_MODELS) {
      try {
        console.log(`Trying Gemini model: ${model}`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": GEMINI_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: messages,
              generationConfig: {
                maxOutputTokens: 700,
                temperature: 0.5,
              },
            }),
          }
        );

        if (response.ok) {
          data = await response.json();
          successfulModel = model;

          console.log(`Successful Gemini model: ${model}`);
          break;
        }

        const errorText = await response.text();

        console.error(
          `Gemini model ${model} failed:`,
          response.status,
          errorText
        );

        lastErrorStatus = response.status;

        // Try another model for quota, temporary service,
        // or unavailable-model errors.
        const shouldFallback = [
          404, 429, 500, 502, 503, 504,
        ].includes(response.status);

        if (!shouldFallback) {
          return NextResponse.json(
            { error: "Failed to get response from AI" },
            { status: response.status, headers: corsHeaders }
          );
        }
      } catch (error) {
        console.error(`Network error with ${model}:`, error);
        lastErrorStatus = 503;
      }
    }

    // No model was able to generate a response
    if (!data) {
      console.error("All Gemini models failed.");

      return NextResponse.json(
        {
          error: "All available AI models are currently unavailable. Please try again later.",
        },
        { status: lastErrorStatus, headers: corsHeaders }
      );
    }

    // Extract the AI message
    const rawMessage =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim() ||
      "No response generated";

    // Split on delimiter to separate answer and followups
    const DELIM = "===SUGGESTED_FOLLOWUPS===";
    let answerText = rawMessage;
    let suggestedFollowups = [];

    if (rawMessage.includes(DELIM)) {
      const [answerPart, followupPartRaw] = rawMessage.split(DELIM);

      answerText = answerPart.trim();

      const cleanJson = followupPartRaw
        .replace(/```json|```/gi, "")
        .trim();

      try {
        const parsed = JSON.parse(cleanJson);

        if (Array.isArray(parsed)) {
          suggestedFollowups = parsed.filter(
            (s) => typeof s === "string"
          );
        } else if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.suggested_followups)
        ) {
          suggestedFollowups =
            parsed.suggested_followups.filter(
              (s) => typeof s === "string"
            );
        }
      } catch {
        const arrayMatch = cleanJson.match(/\[[\s\S]*\]/);

        if (arrayMatch) {
          try {
            const maybeArr = JSON.parse(arrayMatch[0]);

            if (Array.isArray(maybeArr)) {
              suggestedFollowups = maybeArr.filter(
                (s) => typeof s === "string"
              );
            }
          } catch {
            // Ignore parsing errors
          }
        }
      }
    } else {
      // Backward-compatible JSON extraction
      const fenced = rawMessage.match(/```(?:json)?[\s\S]*?```/gi);

      if (fenced && fenced.length) {
        answerText = rawMessage
          .replace(fenced[fenced.length - 1], "")
          .trim();

        const last = fenced[fenced.length - 1]
          .replace(/```json|```/gi, "")
          .trim();

        try {
          const parsed = JSON.parse(last);

          if (Array.isArray(parsed)) {
            suggestedFollowups = parsed.filter(
              (s) => typeof s === "string"
            );
          } else if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.suggested_followups)
          ) {
            suggestedFollowups =
              parsed.suggested_followups.filter(
                (s) => typeof s === "string"
              );
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }

    // Final fallback: inline JSON object
    if (!suggestedFollowups.length) {
      const inlineMatch = rawMessage.match(
        /\{[\s\S]*"suggested_followups"[\s\S]*?\}/
      );

      if (inlineMatch) {
        try {
          const parsed = JSON.parse(inlineMatch[0]);

          if (Array.isArray(parsed.suggested_followups)) {
            suggestedFollowups =
              parsed.suggested_followups.filter(
                (s) => typeof s === "string"
              );

            answerText = rawMessage
              .replace(inlineMatch[0], "")
              .trim();
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }

    // Return the original response structure
    return NextResponse.json(
      {
        text: answerText,
        citations: [
          {
            source: "Islamic Scholarship",
            content: "Based on Quran and Hadith",
          },
        ],
        suggested_followups: suggestedFollowups,
        history: [
          ...(Array.isArray(history) ? history : []),
          { role: "user", content: question },
          { role: "assistant", content: answerText },
        ],
      },
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Chat API error:", error);

    return NextResponse.json(
      { error: "Failed to get response from AI" },
      { status: 500, headers: corsHeaders }
    );
  }
}
