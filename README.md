# Custom Node.js API Gateway

A lightweight, high-performance API Gateway built with Node.js and TypeScript. This project serves as a practical demonstration of enterprise-grade API Gateway patterns, evolving from a simple reverse proxy into a resilient, observable traffic director.

## 🚀 Features

* **Dynamic Routing & Load Balancing:** Configured via `routes.json`, the gateway distributes incoming traffic across a fleet of backend servers using a Round-Robin algorithm.
* **Response Caching (Redis):** Intercepts and caches successful `GET` responses in Redis to drastically reduce backend load and improve response times.
* **Distributed Rate Limiting:** Utilizes Redis (Fixed Window Counter) to track and limit requests globally across potential multiple gateway instances.
* **Circuit Breaker Pattern:** Protects backend services from cascading failures by halting traffic to unresponsive targets and periodically testing for recovery.
* **Observability (Prometheus):** Exposes a `/metrics` endpoint tracking cache hits/misses, circuit breaker trips, and request duration histograms.
* **Authentication:** A global middleware layer that intercepts requests and validates API keys before processing.

## 🏗️ Architecture Flow

    Client Request
          │
          ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                       API Gateway                           │
    │                                                             │
    │  1. Metrics Tracker (Starts timer, tracks route)            │
    │  2. Auth Check (Requires x-api-key header)                  │
    │  3. Rate Limiter (Redis: Max 5 req/min per IP)              │
    │  4. Cache Check (Returns cached response if found)          │
    │  5. Router & Load Balancer (Selects next backend target)    │
    │  6. Circuit Breaker (Trips after 3 failures)                │
    │  7. Reverse Proxy (Forwards request)                        │
    │                                                             │
    │  * Intercepts response to save to Cache on success          │
    │  * Stops timer and logs to Prometheus metrics               │
    └─────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
                    [Backend 1, Backend 2, Backend 3]


## 📋 Prerequisites

To run this project locally, you will need:
* **Node.js** (v16+)
* **npm** or **yarn**
* **Docker** (to easily run a local Redis instance)

## 🛠️ Setup & Installation

**1. Install dependencies:**

    npm install
    npm install express http-proxy-middleware redis prom-client

**2. Start Redis:**
Use Docker to spin up a temporary Redis container on the default port (6379):

    docker run -p 6379:6379 -it redis/redis-stack-server:latest

**3. Configure Routes (`routes.json`):**
Ensure your configuration uses the `targets` array for load balancing:

    {
      "/api/users": {
        "targets": [
          "http://localhost:5001",
          "http://localhost:5003",
          "http://localhost:5004"
        ],
        "rewritePrefix": ""
      }
    }


## 🧪 Testing the Features

You will need a few terminal windows to test the full lifecycle.

### Step 1: Boot up the Gateway & Backends
Start the API Gateway:

    npm run start:gateway

In **three separate terminals**, start the fleet of backend servers:

    PORT=5001 npm run start:backend
    PORT=5002 npm run start:backend
    PORT=5003 npm run start:backend

### Step 2: Test Load Balancing & Caching
Send a valid request to the gateway (Note the `-i` flag to see headers):

    curl -i -H "x-api-key: wubba-lubba-dub-dub" http://localhost:8080/api/users

* **Attempt 1 (Cache Miss):** The request goes to `localhost:5001`. You will see `X-Cache: MISS` in the headers and a `[Cache Stored]` log in the gateway terminal.
* **Attempt 2 (Cache Hit):** Run it again immediately. The request **does not** reach the backend. You will see `X-Cache: HIT` and a `[Cache Hit]` log. 
* Wait 30 seconds for the cache to expire, then run it again. The request will now route to `localhost:5002` (Round-Robin Load Balancing).

### Step 3: Test the Circuit Breaker
Kill all your backend terminals (Ctrl+C). Fire requests at the gateway.

* **Attempts 1-3:** `502 Bad Gateway`.
* **Attempt 4+:** `503 Service Unavailable`. The circuit has **TRIPPED**.
* *Recovery:* Start one backend again, wait 15 seconds, and send a request to see the circuit switch to `Half-Open` and then `Closed`.

### Step 4: Test Rate Limiting
Spam 6 requests rapidly to trigger the Redis rate limiter.

    for i in {1..6}; do curl -s -H "x-api-key: wubba-lubba-dub-dub" http://localhost:8080/api/users; echo ""; done

* **Result:** The 6th request will return `429 Too Many Requests`.

### Step 5: View Prometheus Metrics
The gateway tracks everything that happens. You can view the raw metric data by querying the open `/metrics` endpoint:

    curl http://localhost:8080/metrics

Look for `gateway_cache_operations_total`, `gateway_circuit_breaker_trips_total`, and `gateway_request_duration_seconds` at the bottom of the output.

## 📁 Project Structure

* `gateway.ts`: The core Gateway (Proxy, Cache, Metrics, Rate Limiter, Load Balancer, Circuit Breaker).
* `backend.ts`: A scalable mock Express server used as a target.
* `routes.json`: The dynamic routing and load balancer configuration file.