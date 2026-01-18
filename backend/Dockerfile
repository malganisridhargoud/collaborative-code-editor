FROM python:3.12-slim

# Install system dependencies REQUIRED for mysqlclient + compilers
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    default-jdk \
    pkg-config \
    default-libmysqlclient-dev \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
ENV PYTHONUNBUFFERED=1

CMD ["daphne", "-b", "0.0.0.0", "-p", "8080", "config.asgi:application"]
