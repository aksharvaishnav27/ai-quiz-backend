

## 1. Base URL

- Production: `https://your-hosted-domain`
- Swagger UI: `https://your-hosted-domain/api-docs`

---

## 2. Quick Authentication Flow

1. **Login** – obtain a JWT:
   ```bash
   curl -X POST https://your-hosted-domain/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"student1","password":"password123"}'
   ```
   Response contains `accessToken`. Copy it for subsequent calls.

2. **Use JWT** – include `Authorization: Bearer <token>` in all protected requests.

---

## 3. Executable Sample Requests

### Generate Quiz

```bash
curl -X POST https://your-hosted-domain/quiz/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "grade": "5",
        "subject": "Mathematics",
        "numQuestions": 5,
        "difficulty": "medium"
      }'
```

### Submit Quiz

```bash
curl -X POST https://your-hosted-domain/quiz/submit \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "quizId": "replace-with-real-id",
        "answers": [
          { "questionId": "q1", "answer": "Option A" },
          { "questionId": "q2", "answer": "Option C" }
        ]
      }'
```

### Quiz History

```bash
curl -X GET "https://your-hosted-domain/quiz/history?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Health Check (no auth)

```bash
curl https://your-hosted-domain/health
```

---

## 4. Postman Collection

1. Import `postman_collection.json` (included in the repo).
2. Create an environment with a `baseUrl` variable pointing to `https://your-hosted-domain`.
3. After logging in, set `jwt` environment variable to the returned token; other requests reference `{{jwt}}`.
4. Run the collection or individual requests to exercise the API.

---

## 5. Notes

- Ensure the hosted database schema is migrated by running `npx prisma migrate deploy`.
- Set these variables in the hosting platform: `DATABASE_URL`, `JWT_SECRET`, `GROQ_API_KEY` (or `OPENAI_API_KEY`), `AI_PROVIDER`, `NODE_ENV`.
- Update this file once the production URL is known so others can execute the commands verbatim.

