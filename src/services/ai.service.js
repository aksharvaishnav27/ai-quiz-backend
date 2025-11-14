import Groq from "groq-sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* --------------------------------------------------
   UNIVERSAL RETRY HELPER – handles rate-limit (429),
   network lag, temporary model errors.
-------------------------------------------------- */
async function withRetry(fn, retries = 3, delay = 700) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((res) => setTimeout(res, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

/* --------------------------------------------------
   UNIVERSAL JSON EXTRACTION 
-------------------------------------------------- */
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {}

  // Look for fenced code blocks ```json
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (match) return JSON.parse(match[1]);

  // Generic fenced block
  const match2 = text.match(/```([\s\S]*?)```/);
  if (match2) return JSON.parse(match2[1]);

  throw new Error("❌ AI did not return valid JSON");
}

/* --------------------------------------------------
   MAIN CLASS
-------------------------------------------------- */
class AIService {
  constructor() {
    this.provider = (process.env.AI_PROVIDER || "groq").toLowerCase();

    if (this.provider === "groq") {
      console.log("🔵 Using Groq AI");
      this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
      this.model = "llama-3.1-70b-versatile"; // MOST STABLE FREE MODEL
    } else if (this.provider === "openai") {
      console.log("🟣 Using OpenAI");
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      this.model = process.env.OPENAI_MODEL || "gpt-4o-mini"; // cheap + JSON mode
    } else if (this.provider === "gemini") {
      console.log("🟡 Using Google Gemini (Auto-model detection)");
      this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = process.env.GEMINI_MODEL || "gemini-pro"; // SAFE & STABLE
    } else {
      throw new Error(
        'Invalid AI_PROVIDER. Use "groq", "openai", or "gemini".'
      );
    }
  }

  /* --------------------------------------------------
     CORE UNIVERSAL AI CALL
  -------------------------------------------------- */
  async askAI(system, user, wantsJSON = true) {
    return withRetry(async () => {
      let output = "";

      /* ---------------- GROQ / OPENAI ---------------- */
      if (this.provider === "groq" || this.provider === "openai") {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.6,
          response_format: wantsJSON ? { type: "json_object" } : undefined,
        });

        output = response.choices[0].message.content;
        return output;
      } else if (this.provider === "gemini") {
        /* ---------------- GEMINI ---------------- */
        const model = this.client.getGenerativeModel({ model: this.model });

        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    system +
                    "\n\n" +
                    user +
                    (wantsJSON ? "\nReturn strictly valid JSON only." : ""),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1800,
          },
        });

        output = result.response.text();
        return output;
      }

      throw new Error("❌ Invalid AI provider configured.");
    });
  }

  /* --------------------------------------------------
     1. QUIZ GENERATION
  -------------------------------------------------- */
  async generateQuiz(
    grade,
    subject,
    numQuestions,
    difficulty = "medium",
    history = []
  ) {
    const systemPrompt = `
You are an expert quiz generator. 
Generate exactly ${numQuestions} MCQs for Grade ${grade} ${subject}.

Rules:
- 4 options (A, B, C, D)
- Include "correctAnswer"
- Include "difficulty": "easy" | "medium" | "hard"
- MUST RETURN STRICT JSON ONLY.

Example:
{
  "questions": [
    {
      "questionText": "",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "difficulty": "easy"
    }
  ]
}`;

    const userPrompt =
      history.length > 0
        ? `User's past performance: ${JSON.stringify(
            history
          )}.\nAdapt difficulty.\nReturn ONLY JSON.`
        : `Generate high-quality questions.\nReturn ONLY JSON.`;

    const raw = await this.askAI(systemPrompt, userPrompt, true);
    const parsed = extractJSON(raw);

    if (!parsed.questions || parsed.questions.length === 0) {
      throw new Error("❌ No quiz questions generated");
    }

    return parsed.questions;
  }

  /* --------------------------------------------------
     2. QUIZ EVALUATION
  -------------------------------------------------- */
  async evaluateQuiz(questions, userAnswers) {
    const systemPrompt = `
You are an expert evaluator. Score the quiz and return STRICT JSON:

{
  "score": number,
  "maxScore": number,
  "evaluations": [
    {
      "questionText": "",
      "correctAnswer": "",
      "userAnswer": "",
      "isCorrect": boolean,
      "explanation": ""
    }
  ],
  "improvements": ["", ""]
}`;

    const userPrompt = `Evaluate:
${JSON.stringify(
  questions.map((q, i) => ({
    questionText: q.questionText,
    correctAnswer: q.correctAnswer,
    userAnswer: userAnswers[i] || "",
  }))
)}
Return ONLY JSON.`;

    const raw = await this.askAI(systemPrompt, userPrompt, true);
    return extractJSON(raw);
  }

  /* --------------------------------------------------
     3. HINT GENERATION
  -------------------------------------------------- */
  async generateHint(questionText, subject, grade) {
    const systemPrompt = `
You are a tutor. Give a hint but DO NOT reveal the answer.
Grade: ${grade}, Subject: ${subject}.`;

    const userPrompt = `Question: ${questionText}\nGive a short hint:`;

    const raw = await this.askAI(systemPrompt, userPrompt, false);
    return raw.trim();
  }
}

export default new AIService();
