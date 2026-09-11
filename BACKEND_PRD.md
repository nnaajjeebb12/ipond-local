# i-Pond Backend - PRD: Modernization & Expansion

## ⚠️ LARGE PROJECT NOTICE

This is a **LARGE SCALE PROJECT** with multi-component architecture, time-series data handling, Docker orchestration, and multiple microservices. Estimate 8-12 weeks for full implementation. Plan for ongoing database optimization and scaling.

## Project Overview

Redesign and modernize the existing backend to support high-volume time-series sensor data using PostgreSQL with TimescaleDB extension. Implement containerized architecture with Docker for scalability and consistency.

## Architecture

- **Runtime**: Node.js 20+ (Express.js or Fastify)
- **ORM**: Prisma (with PostgreSQL driver)
- **Database**: PostgreSQL 15+ with TimescaleDB extension
- **Containerization**: Docker & Docker Compose
- **Caching**: Redis (real-time data, session management)
- **API**: REST endpoints (GraphQL optional for future)
- **Hardware**: Single VPS for 10k users (scalable to multi-instance)

## Core Modules

### 1. Sensor Data Management

- Ingest high-frequency sensor readings (temperature, pH, DOX, salinity, humidity)
- Time-series data storage with automatic compression
- Batch inserts for performance
- Real-time streaming to connected clients

### 2. Data Models (Multi-Tenant)

**Prisma Schema Structure:**

```
- Organization (accounts/companies with 5-year license)
  └─ Farm (locations/monitoring sites)
     └─ Machine (ESP32 units with sensors)
        └─ SensorReading (time-series hypertable)

- User (organization staff)
- Alert (threshold violations)
```

**Key Tables:**

- `organizations` - License holders
- `farms` - Physical locations (ponds, tanks)
- `machines` - ESP32 units (each with unique apiKey)
- `sensor_readings` - TimescaleDB hypertable (temperature, pH, DO, salinity)
- `users` - Access control per organization
- `alerts` - Threshold violation logs

### 3. API Endpoints

**Data Ingestion (ESP32)**

- `POST /api/ingest` - Batch upload sensor readings (header: `X-API-Key`)
  - Accepts 30-second buffered JSON array from devices
  - Automatic alert trigger on threshold violations
  - Lightweight authentication (no JWT overhead)

**Readings (Dashboard)**

- `GET /api/farms/:farmId/readings?machineId=&start=&end=&limit=5000`
  - Last 24 hours: raw data for charts
  - Last 7 days: hourly averages (via `time_bucket()` aggregates)
  - Uses TimescaleDB compression for fast queries
- `GET /api/farms/:farmId/readings/latest` - Last reading per machine
- `GET /api/farms/:farmId/readings/stats` - Hour/daily/weekly aggregates

**Machines (Device Management)**

- `GET /api/organizations/:orgId/farms/:farmId/machines` - List machines
- `POST /api/organizations/:orgId/farms/:farmId/machines` - Register new machine
- `PUT /api/organizations/:orgId/machines/:machineId` - Update machine settings

**Farms**

- `GET /api/organizations/:orgId/farms` - List all farms
- `POST /api/organizations/:orgId/farms` - Create farm
- `GET /api/organizations/:orgId/farms/:farmId/dashboard` - Consolidated view

**Alerts**

- `GET /api/organizations/:orgId/alerts?farm=` - Recent violations
- `POST /api/organizations/:orgId/alerts/config` - Set thresholds

**Authentication**

- `POST /auth/login` - JWT + refresh token
- `POST /auth/refresh` - Refresh token endpoint
- `POST /auth/logout` - Invalidate session

### 5. Database Optimization

- **Hypertables**: Auto-partition by time (7-day chunks)
- **Compression**: 96% reduction for historical data (>7 days old)
- **Continuous Aggregates**: Pre-computed hourly/daily/weekly stats
- **Indexing**: (machineId, timestamp) for fast time-range queries
- **Retention**: Auto-compress old data, configurable deletion after N years
- **Batch Inserts**: Prisma `createMany()` for 30-reading batches
- **Connection Pooling**: PgBouncer in transaction mode
- **Caching**: Redis for latest readings, threshold states

### 6. Real-time Features

- WebSocket support for live data streaming
- Server-sent events (SSE) alternative
- Redis Pub/Sub for inter-service communication

### 7. Admin Interface

- User management & organization setup
- Farm & machine configuration
- Alert threshold settings
- System health monitoring & backup status

## Technology Stack

| Component        | Technology             | Reason                                           |
| ---------------- | ---------------------- | ------------------------------------------------ |
| Runtime          | Node.js 20+            | Performance, async support                       |
| Framework        | Express.js or Fastify  | Lightweight, HTTP routing                        |
| ORM              | Prisma                 | Type-safe, auto-migrations, multi-tenant support |
| DB               | PostgreSQL 15+         | Reliability, ACID, TimescaleDB compat            |
| Time-Series      | TimescaleDB            | Hypertables, compression, spatial queries        |
| Caching          | Redis                  | Fast reads, session store, pub/sub               |
| Containerization | Docker                 | Consistency, prod/dev parity                     |
| Orchestration    | Docker Compose         | Single-VPS deployment                            |
| Validation       | Zod                    | Type-safe input validation                       |
| Auth             | JWT + bcrypt           | Stateless, refresh tokens                        |
| ESP32            | Arduino + ArduinoJson  | OTA updates, buffered batch upload               |
| Testing          | Jest + Supertest       | Unit, integration, API tests                     |
| Monitoring       | Winston logs + metrics | Simple alerting, debugging                       |

## Docker Structure

```
docker-compose.yml
├── postgres (PostgreSQL 15 + TimescaleDB extension)
├── redis (caching & session store)
├── adminer (pgAdmin alternative - optional)
└── backend (Node.js API service)
```

## Development Workflow

1. **Phase 1**: Docker setup locally (Postgres + TimescaleDB)
2. **Phase 2**: Define Prisma schema, generate migrations
3. **Phase 3**: Build API endpoints (ingest, readings, machines, farms)
4. **Phase 4**: Implement authentication & organization isolation
5. **Phase 5**: Add real-time features (WebSocket/alerts)
6. **Phase 6**: Performance testing & optimization
7. **Phase 7**: Production deployment (backup strategy, monitoring)

## Storage Volume Calculations

**Per-Machine 5-Year Projections:**

- Readings: 1/second × 31,536,000 seconds/year = 31.5M rows/year
- Raw data: ~15.7 GB uncompressed (100 bytes/row)
- Compressed (96%): ~630 MB per machine

| Machines | Total Storage | VPS Size Required                |
| -------: | ------------- | -------------------------------- |
|     1-10 | < 10 GB       | 50 GB SSD (DigitalOcean/Hetzner) |
|   50-100 | 30-60 GB      | 250 GB SSD                       |
|     500+ | > 300 GB      | NAS or cloud object storage      |

**Backup & Retention:**

- Daily `pg_dump` to S3/Backblaze B2
- Point-in-time recovery via WAL archiving
- 5-year retention (automatic with selective deletion)

## Database Migration Strategy

- Export current schema from existing backend
- Design new Prisma schema with multi-tenant support
- Create migration scripts for data transformation
- Test import in Docker environment with sample data
- Validate data integrity & timestamp accuracy
- Implement rollback & pivot procedures
- Run in parallel (old & new) during transition window

## Scalability Roadmap (for 10k+ users)

**Phase 1 (Initial):**

- Single VPS: Node.js + PostgreSQL + Redis (Docker Compose)
- 10-50 machines per organization
- ~200 GB/month aggregate bandwidth

**Phase 2 (Growth - when needed):**

- Horizontal: Multiple Node.js replicas behind Nginx/HAProxy
- Single PostgreSQL (upgraded specs)
- Read replicas for reporting queries

**Phase 3 (Enterprise Scale):**

- Kubernetes cluster (EKS/GKE)
- Database sharding by organization
- Dedicated TimescaleDB instances per customer tier

**Phase 4 (Multi-Region):**

- Regional PostgreSQL clusters
- Data replication between regions
- Local API endpoints per region

## Security Requirements

- **HTTPS/TLS** for all endpoints (Let's Encrypt certificates)
- **JWT tokens** with 15-min expiry + refresh tokens
- **API Key** per machine (X-API-Key header for ESP32)
- **Rate limiting** on ingest endpoint (1000 req/min per machine)
- **SQL injection prevention** via Prisma parameterized queries
- **CORS policy** strict (frontend origin only)
- **Secrets management** (`.env` files, production vault)
- **Multi-tenancy isolation** at database query level

## Testing Strategy

- **Unit tests**: 70%+ coverage on utilities, validation
- **Integration tests**: All API endpoints with real database
- **Load testing**: 1000+ concurrent users, 1000/min reading ingest
- **Migration testing**: Data integrity verification
- **Failover testing**: ESP32 retry logic, backup persistence

## Deployment

- **Development**: Docker Compose locally
- **Staging**: Single VPS replica
- **Production**: Docker on main VPS with automated backups
- **CI/CD**: GitHub Actions for automated testing & deployment

## Timeline (Estimated for 10k Users)

- Setup & Docker config: 1 week
- Prisma schema & migrations: 1.5 weeks
- Core API endpoints: 2.5 weeks
- ESP32 integration & ingestion: 1.5 weeks
- Real-time features (WebSocket/alerts): 2 weeks
- Testing & load testing: 1.5 weeks
- Optimization & monitoring: 1 week
- Pre-production deployment: 1 week

**Total: 12-13 weeks**

## Success Criteria (10k User Target)

- **Ingest**: 1000+ readings/minute per farm (batched from ESP32)
- **Query Performance**: < 500ms for 1-month history, < 2s for 1-year history
- **Compression**: 95%+ reduction for >7 day old data (TimescaleDB default)
- **Uptime**: 99.5% SLA (single-instance deployment)
- **Data Integrity**: Zero reading loss, automatic deduplication
- **Multi-Tenancy**: Complete org/farm isolation
- **Latency**: < 5s end-to-end from ESP32 to dashboard
- **Scalability**: Support 10k concurrent web users + 1000+ active devices
- **Backup**: Daily snapshots, 5-year retention
