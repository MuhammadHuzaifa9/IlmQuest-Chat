
import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash-lite";

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

    // System prompt to set persona and instruct follow-ups
    const systemPrompt = `
You are an expert Islamic Q&A Assistant named Ilmquest.
Answer questions based on the Quran, Hadith, and Islamic scholarship.
Be concise, accurate, and respectful.

At the end of your answer, provide 3 short suggested follow-up questions that a user might ask next.
Format them as a JSON array under "suggested_followups".
`;

    // Build messages (last 10 chat messages maximum)
    // Gemini uses "model" instead of "assistant" for AI messages.
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

    // Call the Google Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);

      return NextResponse.json(
        { error: "Failed to get response from AI" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();

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

      // Clean the answer
      answerText = answerPart.trim();

      // Clean candidate JSON (strip backticks/fences and whitespace)
      const cleanJson = followupPartRaw
        .replace(/```json|```/gi, "")
        .trim();

      // Try to parse as JSON array; if it's an object, try extracting .suggested_followups
      try {
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed)) {
          suggestedFollowups = parsed.filter((s) => typeof s === "string");
        } else if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.suggested_followups)
        ) {
          suggestedFollowups = parsed.suggested_followups.filter(
            (s) => typeof s === "string"
          );
        }
      } catch {
        // If parsing fails, attempt to extract the first [...] array
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
            // ignore
          }
        }
      }
    } else {
      // Backward-compatible: try to strip any code-fenced JSON block from the end
      const fenced = rawMessage.match(/```(?:json)?[\s\S]*?```/gi);
      if (fenced && fenced.length) {
        // Remove fenced block from visible text
        answerText = rawMessage
          .replace(fenced[fenced.length - 1], "")
          .trim();

        // Try to parse the last fenced block
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
            suggestedFollowups = parsed.suggested_followups.filter(
              (s) => typeof s === "string"
            );
          }
        } catch {
          // ignore
        }
      }
    }

    // FINAL fallback: detect inline JSON object containing suggested_followups
    if (!suggestedFollowups.length) {
      const inlineMatch = rawMessage.match(
        /\{[\s\S]*"suggested_followups"[\s\S]*?\}/
      );

      if (inlineMatch) {
        try {
          const parsed = JSON.parse(inlineMatch[0]);
          if (Array.isArray(parsed.suggested_followups)) {
            suggestedFollowups = parsed.suggested_followups.filter(
              (s) => typeof s === "string"
            );

            // Remove inline JSON from visible answer
            answerText = rawMessage.replace(inlineMatch[0], "").trim();
          }
        } catch {
          // ignore
        }
      }
    }

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
