FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# ✅ REQUIRED system dependencies for mysqlclient + Java + Channels
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    default-jdk \
    pkg-config \
    libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# ✅ Cloud Run requires PORT=8080
CMD daphne -b 0.0.0.0 -p $PORT config.asgi:application

