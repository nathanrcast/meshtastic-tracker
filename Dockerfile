FROM node:20-slim AS frontend
WORKDIR /build
COPY web/package.json ./
RUN npm install
COPY web/ .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir . && \
    adduser --disabled-password --no-create-home appuser && \
    mkdir -p /app/data && chown appuser /app/data
COPY src/ src/

COPY --from=frontend /build/dist web/dist/

USER appuser
EXPOSE 8000
CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
