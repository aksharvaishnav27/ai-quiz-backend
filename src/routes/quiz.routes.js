import express from "express";
import { body, query, validationResult } from "express-validator";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { PrismaClient } from "@prisma/client";
import aiService from "../services/ai.service.js";

const router = express.Router();
const prisma = new PrismaClient();

// All quiz routes require authentication
router.use(authMiddleware);

/**
 * @swagger
 * /quiz/generate:
 *   post:
 *     summary: Generate a new quiz using AI
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - grade
 *               - subject
 *               - numQuestions
 *             properties:
 *               grade:
 *                 type: string
 *               subject:
 *                 type: string
 *               numQuestions:
 *                 type: integer
 *               difficulty:
 *                 type: string
 *                 enum: [easy, medium, hard]
 *     responses:
 *       200:
 *         description: Quiz generated successfully
 *       400:
 *         description: Invalid input
 */
router.post(
  "/generate",
  [
    body("grade").notEmpty().withMessage("Grade is required"),
    body("subject").notEmpty().withMessage("Subject is required"),
    body("numQuestions")
      .isInt({ min: 1, max: 50 })
      .withMessage("Number of questions must be between 1 and 50"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { grade, subject, numQuestions, difficulty = "medium" } = req.body;
      const userId = req.userId;

      // Get user's quiz history for adaptive difficulty
      const pastQuizzes = await prisma.quizSubmission.findMany({
        where: { userId },
        include: { quiz: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const userHistory = pastQuizzes.map((q) => ({
        subject: q.quiz.subject,
        score: q.percentage,
        difficulty: q.quiz.difficulty,
      }));

      // Generate quiz using AI
      const aiQuestions = await aiService.generateQuiz(
        grade,
        subject,
        numQuestions,
        difficulty,
        userHistory
      );

      // Create quiz in database
      const quiz = await prisma.quiz.create({
        data: {
          userId,
          grade,
          subject,
          difficulty,
          totalQuestions: numQuestions,
          maxScore: numQuestions * 10, // 10 points per question
          questions: {
            create: aiQuestions.map((q, index) => ({
              questionText: q.questionText,
              correctAnswer: q.correctAnswer,
              difficulty: q.difficulty || difficulty,
              options: q.options || [],
              questionNumber: index + 1,
            })),
          },
        },
        include: {
          questions: {
            orderBy: { questionNumber: "asc" },
          },
        },
      });

      res.json({
        quizId: quiz.id,
        questions: quiz.questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          options: q.options,
          questionNumber: q.questionNumber,
          difficulty: q.difficulty,
        })),
      });
    } catch (error) {
      console.error("Quiz generation error:", {
        message: error.message,
        provider: process.env.AI_PROVIDER,
        stack: error.stack,
      });

      // Provide user-friendly error messages
      let userMessage = "Failed to generate quiz";
      if (error.message.includes("API")) {
        userMessage =
          "AI service is not configured. Please check your API key and provider settings.";
      } else if (
        error.message.includes("authentication") ||
        error.message.includes("401") ||
        error.message.includes("403")
      ) {
        userMessage =
          "AI service authentication failed. Please check your API key.";
      } else if (
        error.message.includes("rate limit") ||
        error.message.includes("429")
      ) {
        userMessage =
          "AI service rate limit exceeded. Please try again in a moment.";
      }

      res.status(500).json({ message: userMessage, error: error.message });
    }
  }
);

/**
 * @swagger
 * /quiz/submit:
 *   post:
 *     summary: Submit quiz answers for evaluation
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quizId
 *               - answers
 *             properties:
 *               quizId:
 *                 type: string
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     questionId:
 *                       type: string
 *                     answer:
 *                       type: string
 *     responses:
 *       200:
 *         description: Quiz evaluated successfully
 */
router.post(
  "/submit",
  [
    body("quizId").notEmpty().withMessage("Quiz ID is required"),
    body("answers").isArray().withMessage("Answers must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { quizId, answers } = req.body;
      const userId = req.userId;

      // Get quiz with questions
      const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        include: { questions: true },
      });

      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      if (quiz.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Align questions by questionNumber to keep deterministic ordering
      const orderedQuestions = [...quiz.questions].sort(
        (a, b) => a.questionNumber - b.questionNumber
      );

      const answerMap = new Map(
        (answers || []).map((item) => [item.questionId, item.answer || ""])
      );

      // Evaluate using AI (single ordered array of answers)
      const evaluation = await aiService.evaluateQuiz(
        orderedQuestions,
        orderedQuestions.map((question) => answerMap.get(question.id) || "")
      );

      const evaluationItems = evaluation?.evaluations || [];
      const improvements = evaluation?.improvements || [];

      // Create submission
      const submission = await prisma.quizSubmission.create({
        data: {
          quizId,
          userId,
          score: evaluation.score || 0,
          maxScore: evaluation.maxScore || quiz.maxScore,
          percentage:
            ((evaluation.score || 0) / (evaluation.maxScore || quiz.maxScore)) *
            100,
          improvements,
          questionSubmissions: {
            create: orderedQuestions.map((question, index) => {
              const evaluationItem = evaluationItems[index] || {};
              const userAnswer =
                answerMap.get(question.id) ?? evaluationItem.userAnswer ?? "";
              const isCorrect =
                typeof evaluationItem.isCorrect === "boolean"
                  ? evaluationItem.isCorrect
                  : userAnswer === question.correctAnswer;

              return {
                questionId: question.id,
                userAnswer,
                isCorrect,
              };
            }),
          },
        },
        include: {
          questionSubmissions: {
            include: {
              question: true,
            },
          },
        },
      });

      // Update quiz score
      await prisma.quiz.update({
        where: { id: quizId },
        data: { score: submission.score },
      });

      res.json({
        submissionId: submission.id,
        quizId,
        score: submission.score,
        maxScore: submission.maxScore,
        percentage: submission.percentage,
        evaluations: submission.questionSubmissions.map((qs) => ({
          questionId: qs.questionId,
          questionText: qs.question.questionText,
          userAnswer: qs.userAnswer,
          correctAnswer: qs.question.correctAnswer,
          isCorrect: qs.isCorrect,
        })),
        improvements: submission.improvements,
      });
    } catch (error) {
      console.error("Quiz submission error:", error);
      res
        .status(500)
        .json({ message: error.message || "Failed to submit quiz" });
    }
  }
);

/**
 * @swagger
 * /quiz/history:
 *   get:
 *     summary: Get quiz history with filters
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: grade
 *         schema:
 *           type: string
 *       - in: query
 *         name: subject
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: minMarks
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Quiz history retrieved successfully
 */
router.get("/history", async (req, res) => {
  try {
    const { grade, subject, from, to, minMarks } = req.query;
    const userId = req.userId;

    const where = {
      userId,
      ...(grade && { quiz: { grade } }),
      ...(subject && { quiz: { subject } }),
      ...(from && { createdAt: { gte: new Date(from) } }),
      ...(to && { createdAt: { lte: new Date(to) } }),
      ...(minMarks && { percentage: { gte: parseFloat(minMarks) } }),
    };

    const submissions = await prisma.quizSubmission.findMany({
      where,
      include: {
        quiz: {
          include: {
            questions: true,
          },
        },
        questionSubmissions: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      count: submissions.length,
      submissions: submissions.map((sub) => ({
        id: sub.id,
        quizId: sub.quizId,
        grade: sub.quiz.grade,
        subject: sub.quiz.subject,
        score: sub.score,
        maxScore: sub.maxScore,
        percentage: sub.percentage,
        improvements: sub.improvements,
        createdAt: sub.createdAt,
        totalQuestions: sub.quiz.totalQuestions,
        correctAnswers: sub.questionSubmissions.filter((qs) => qs.isCorrect)
          .length,
      })),
    });
  } catch (error) {
    console.error("Quiz history error:", error);
    res.status(500).json({ message: "Failed to fetch quiz history" });
  }
});

/**
 * @swagger
 * /quiz/submission/{submissionId}:
 *   get:
 *     summary: Get quiz submission details
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Submission retrieved successfully
 */
router.get("/submission/:submissionId", async (req, res) => {
  try {
    const { submissionId } = req.params;
    const userId = req.userId;

    const submission = await prisma.quizSubmission.findUnique({
      where: { id: submissionId },
      include: {
        quiz: {
          include: {
            questions: true,
          },
        },
        questionSubmissions: {
          include: {
            question: true,
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (submission.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const orderedQuestionSubmissions = [...submission.questionSubmissions].sort(
      (a, b) =>
        (a.question?.questionNumber || 0) - (b.question?.questionNumber || 0)
    );

    res.json({
      submissionId: submission.id,
      quizId: submission.quizId,
      grade: submission.quiz.grade,
      subject: submission.quiz.subject,
      difficulty: submission.quiz.difficulty,
      createdAt: submission.createdAt,
      score: submission.score,
      maxScore: submission.maxScore,
      percentage: submission.percentage,
      totalQuestions: submission.quiz.totalQuestions,
      improvements: submission.improvements || [],
      evaluations: orderedQuestionSubmissions.map((qs) => ({
        questionId: qs.questionId,
        questionNumber: qs.question?.questionNumber || null,
        questionText: qs.question?.questionText || "",
        correctAnswer: qs.question?.correctAnswer || "",
        userAnswer: qs.userAnswer || "",
        isCorrect: qs.isCorrect,
      })),
    });
  } catch (error) {
    console.error("Get submission error:", error);
    res.status(500).json({ message: "Failed to fetch submission" });
  }
});

/**
 * @swagger
 * /quiz/{quizId}:
 *   get:
 *     summary: Get a quiz by ID
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Quiz retrieved successfully
 */
router.get("/:quizId", async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.userId;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          orderBy: { questionNumber: "asc" },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (quiz.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json({
      quizId: quiz.id,
      grade: quiz.grade,
      subject: quiz.subject,
      difficulty: quiz.difficulty,
      totalQuestions: quiz.totalQuestions,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: q.options,
        questionNumber: q.questionNumber,
        difficulty: q.difficulty,
      })),
    });
  } catch (error) {
    console.error("Get quiz error:", error);
    res.status(500).json({ message: "Failed to fetch quiz" });
  }
});

/**
 * @swagger
 * /quiz/retry/{quizId}:
 *   post:
 *     summary: Retry a previous quiz
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - answers
 *             properties:
 *               answers:
 *                 type: array
 *     responses:
 *       200:
 *         description: Quiz retried successfully
 */
router.post("/retry/:quizId", async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers } = req.body;
    const userId = req.userId;

    // Get original quiz
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (quiz.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const orderedQuestions = [...quiz.questions].sort(
      (a, b) => a.questionNumber - b.questionNumber
    );

    const answerMap = new Map(
      (answers || []).map((item) => [item.questionId, item.answer || ""])
    );

    const evaluation = await aiService.evaluateQuiz(
      orderedQuestions,
      orderedQuestions.map((question) => answerMap.get(question.id) || "")
    );

    const evaluationItems = evaluation?.evaluations || [];
    const improvements = evaluation?.improvements || [];

    // Create new submission
    const submission = await prisma.quizSubmission.create({
      data: {
        quizId,
        userId,
        score: evaluation.score || 0,
        maxScore: evaluation.maxScore || quiz.maxScore,
        percentage:
          ((evaluation.score || 0) / (evaluation.maxScore || quiz.maxScore)) *
          100,
        improvements,
        questionSubmissions: {
          create: orderedQuestions.map((question, index) => {
            const evaluationItem = evaluationItems[index] || {};
            const userAnswer =
              answerMap.get(question.id) ?? evaluationItem.userAnswer ?? "";
            const isCorrect =
              typeof evaluationItem.isCorrect === "boolean"
                ? evaluationItem.isCorrect
                : userAnswer === question.correctAnswer;

            return {
              questionId: question.id,
              userAnswer,
              isCorrect,
            };
          }),
        },
      },
      include: {
        questionSubmissions: {
          include: {
            question: true,
          },
        },
      },
    });

    res.json({
      submissionId: submission.id,
      quizId,
      score: submission.score,
      maxScore: submission.maxScore,
      percentage: submission.percentage,
      evaluations: submission.questionSubmissions.map((qs) => ({
        questionId: qs.questionId,
        questionText: qs.question.questionText,
        userAnswer: qs.userAnswer,
        correctAnswer: qs.question.correctAnswer,
        isCorrect: qs.isCorrect,
      })),
      improvements: submission.improvements,
    });
  } catch (error) {
    console.error("Quiz retry error:", error);
    res.status(500).json({ message: error.message || "Failed to retry quiz" });
  }
});

/**
 * @swagger
 * /quiz/{quizId}/hint/{questionId}:
 *   get:
 *     summary: Get a hint for a specific question
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Hint generated successfully
 */
router.get("/:quizId/hint/:questionId", async (req, res) => {
  try {
    const { quizId, questionId } = req.params;
    const userId = req.userId;

    // Get quiz and question
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: true,
      },
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (quiz.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const question = quiz.questions.find((q) => q.id === questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    // Check if hint already exists
    let hint = await prisma.hint.findFirst({
      where: { questionId },
    });

    if (!hint) {
      // Generate hint using AI
      const hintText = await aiService.generateHint(
        question.questionText,
        quiz.subject,
        quiz.grade
      );

      // Save hint
      hint = await prisma.hint.create({
        data: {
          questionId,
          hintText,
        },
      });
    }

    res.json({
      hintId: hint.id,
      hintText: hint.hintText,
    });
  } catch (error) {
    console.error("Hint generation error:", error);
    res
      .status(500)
      .json({ message: error.message || "Failed to generate hint" });
  }
});

export default router;
