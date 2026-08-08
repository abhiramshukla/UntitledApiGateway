# Custom Node.js API Gateway

A lightweight, high-performance API Gateway built with Node.js and TypeScript. This project serves as a practical demonstration of core API Gateway patterns including authentication, distributed rate limiting, circuit breaking, and dynamic configuration.

## 🚀 Features

* **Dynamic Routing:** Routes are configured via `routes.json`, allowing new backend services to be added without modifying the codebase.
* **Distributed Rate Limiting:** Utilizes Redis via a Fixed Window Counter algorithm to track and limit requests globally across potential multiple gateway instances.
* **Circuit Breaker Pattern:** Protects backend services from cascading failures by halting traffic to unresponsive targets and periodically testing for recovery.
* **Authentication:** A global middleware layer that intercepts requests and validates API keys before processing.

## 🏗️ Architecture Flow

```text
Client Request
      │
      ▼
┌───────────────────────────────────────────────┐
│                 API Gateway                   │
│                                               │
│  1. Auth Check (Requires x-api-key header)    │
│  2. Rate Limiter (Redis: Max 5 req/min)       │
│  3. Router (Reads routes.json lookup table)   │
│  4. Circuit Breaker (Trips after 3 failures)  │
│  5. Reverse Proxy (Forwards request)          │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
                Backend Service(s)
```

## 📋 Prerequisites

To run this project locally, you will need:
* **Node.js** (v16+)
* **npm** or **yarn**
* **Docker** (to easily run a local Redis instance)

## 🛠️ Setup & Installation

**1. Install dependencies:**
```bash
npm install
```

**2. Start Redis:**
Use Docker to spin up a temporary Redis container on the default port (6379):
```bash
docker run -p 6379:6379 -it redis/redis-stack-server:latest
```

**3. Configure Routes (Optional):**
You can modify the routing table in `routes.json`. By default, it maps `/api/users` to a dummy backend running on port 5001.

## 🧪 Testing the Features

You will need three terminal windows to test the full lifecycle:
1. Redis (Running via Docker)
2. The API Gateway
3. The Dummy Backend

### Step 1: Boot up the Gateway
Start the API Gateway. It will connect to Redis and map the routes.
```bash
npm run start:gateway
```

### Step 2: Test the Bouncer (Authentication)
Send a request without the required API key.
```bash
curl http://localhost:8080/api/users
```
* **Expected Result:** `401 Unauthorized`

### Step 3: Test the Circuit Breaker (Fail-Fast)
Do **not** start the backend server yet. Send valid requests to trigger a failure.
```bash
curl -H "x-api-key: wubba-lubba-dub-dub" http://localhost:8080/api/users
```
* **Attempt 1-3:** `502 Bad Gateway` (Gateway tried to reach the backend, but it's offline).
* **Attempt 4:** `503 Service Unavailable` (The circuit has **TRIPPED**. The gateway instantly rejects the request without attempting to contact the backend to prevent cascading failures).

### Step 4: Test Recovery (Half-Open State)
Start the dummy backend in a new terminal:
```bash
npm run start:backend
```
Wait 15 seconds for the Circuit Breaker's timeout to expire, then hit the gateway again:
```bash
curl -H "x-api-key: wubba-lubba-dub-dub" http://localhost:8080/api/users
```
* **Expected Result:** The gateway will log `🟡 Circuit Half-Open`, the request will succeed with a `200 OK` JSON response, and the circuit will close (`🟢 Circuit Closed`).

### Step 5: Test the Rate Limiter
Fire 6 valid requests rapidly to trigger the Redis rate limiter (Limit is set to 5 per minute).
```bash
for i in {1..6}; do curl -s -H "x-api-key: wubba-lubba-dub-dub" http://localhost:8080/api/users; echo ""; done
```
* **Expected Result:** The 6th request will return `429 Too Many Requests`.

## 📁 Project Structure

* `gateway.ts`: The main entry point containing the Proxy, Rate Limiter, and Circuit Breaker logic.
* `backend.ts`: A mock Express server used as a target for routing tests.
* `routes.json`: The dynamic routing configuration file.