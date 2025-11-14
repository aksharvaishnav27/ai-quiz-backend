# AI Quizzer Backend

AI-powered Quiz Application Backend built with Node.js, Express, PostgreSQL, and Prisma ORM.

## Features

- **JWT Authentication** - Secure user authentication
- **AI-Powered Quiz Generation** - Generate quizzes using Groq or OpenAI
- **Adaptive Difficulty** - AI adapts difficulty based on user history
- **Quiz Evaluation** - AI evaluates answers and provides feedback
- **Hint Generation** - AI-generated hints for questions
- **Quiz History** - Track all quiz attempts with filters
- **Retry Functionality** - Retry previous quizzes
- **RESTful API** - Well-documented API endpoints
- **Swagger Documentation** - Interactive API documentation

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Groq API Key or OpenAI API Key

## Setup

### 1. Clone and Install

```bash
cd backend
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `GROQ_API_KEY` or `OPENAI_API_KEY` - AI provider API key
- `AI_PROVIDER` - Either "groq", "openai", or "gemini"

Optional:

- `OPENAI_MODEL` - Overrides the default OpenAI model (defaults to `gpt-4o-mini`)
- `GEMINI_API_KEY` - Required if `AI_PROVIDER` is set to `gemini`
- `GEMINI_MODEL` - Overrides the default Gemini model (`gemini-1.5-flash`)

### 3. Database Setup

```bash
# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

### 4. Run Development Server

```bash
npm run dev
```

Server will run on `http://localhost:3000`

## Docker Setup

### Using Docker Compose

```bash
# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The backend will be available at `http://localhost:3000`

## API Documentation

Once the server is running, visit:

- **Swagger UI**: `http://localhost:3000/api-docs`

## API Endpoints

### Authentication

- `POST /auth/login` - User login (accepts any username/password)

### Quiz Management

- `POST /quiz/generate` - Generate a new quiz using AI
- `POST /quiz/submit` - Submit quiz answers for evaluation
- `GET /quiz/history` - Get quiz history with filters
- `POST /quiz/retry/:quizId` - Retry a previous quiz
- `GET /quiz/:quizId/hint/:questionId` - Get hint for a question

### Health Check

- `GET /health` - Check API status

## API Usage Examples

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "student1", "password": "password123"}'
```

### Generate Quiz

```bash
curl -X POST http://localhost:3000/quiz/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "grade": "5",
    "subject": "Mathematics",
    "numQuestions": 10,
    "difficulty": "medium"
  }'
```

### Submit Quiz

```bash
curl -X POST http://localhost:3000/quiz/submit \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quizId": "quiz-id-here",
    "answers": [
      {"questionId": "q1", "answer": "Option A"},
      {"questionId": "q2", "answer": "Option B"}
    ]
  }'
```

## Deployment

### Render / Railway / DigitalOcean

1. Set environment variables in your hosting platform
2. Ensure PostgreSQL database is provisioned
3. Update `DATABASE_URL` in environment variables
4. Deploy using:
   - Render: Connect GitHub repo
   - Railway: `railway up`
   - DigitalOcean: Use App Platform

### Environment Variables for Production

Make sure to set:

- `DATABASE_URL` - Production database URL
- `JWT_SECRET` - Strong secret key
- `GROQ_API_KEY` or `OPENAI_API_KEY`
- `AI_PROVIDER`
- `NODE_ENV=production`

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── middleware/
│   │   └── auth.middleware.js # JWT authentication
│   ├── routes/
│   │   ├── auth.routes.js     # Authentication routes
│   │   └── quiz.routes.js     # Quiz routes
│   ├── services/
│   │   └── ai.service.js      # AI integration service
│   └── server.js              # Express server
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Security Notes

- Passwords are hashed using bcrypt
- JWT tokens expire after 7 days (configurable)
- All quiz routes require authentication
- User can only access their own quizzes
