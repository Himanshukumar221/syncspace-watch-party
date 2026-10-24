# SyncSpace — YouTube Watch Party

A real-time watch-party application built with React, TypeScript, Vite, Node.js, Express, Socket.IO and PostgreSQL.

## Features

- Create rooms with unique room codes.
- Request to join a room; the Host approves or rejects requests.
- Host and Moderator playback controls (play, pause, seek and change YouTube video).
- Host can promote/demote participants and remove them.
- Live participant and playback updates over Socket.IO.
- PostgreSQL stores rooms and participants, including roles, connection status and playback state.

## Requirements

- Node.js (LTS recommended)
- PostgreSQL 18 or compatible
- npm

## Database setup

Create a database named `watch_party` in PostgreSQL, then run the following SQL while connected to that database:

```sql
CREATE TABLE rooms (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_code VARCHAR(20) UNIQUE NOT NULL,
  host_username VARCHAR(100) NOT NULL,
  video_id VARCHAR(100),
  is_playing BOOLEAN NOT NULL DEFAULT FALSE,
  current_time_seconds NUMERIC(12, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE participants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'Participant'
    CHECK (role IN ('Host', 'Moderator', 'Participant')),
  is_connected BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, username)
);

CREATE TABLE approval_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  requester_username VARCHAR(100) NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  request_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
```

## Configure backend

Create `server/.env` locally (do not commit it):

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=watch_party
DB_USER=postgres
DB_PASSWORD=your_local_postgres_password
PORT=3001
```

Install and run backend:

```bash
cd server
npm install
npm run dev
```

API health check: `http://localhost:3001/`

## Run frontend

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

## Architecture overview

React renders the room UI and YouTube player. The frontend emits Socket.IO events to the Express server. The server validates the user's role, updates room state, and broadcasts events to other sockets in the same room. PostgreSQL stores room metadata, participants and selected state so database records survive a process restart.

## Production deployment checklist

- Deploy the frontend and backend to a public hosting provider that supports persistent WebSocket connections.
- Provision a managed PostgreSQL database and set environment variables in the hosting dashboard.
- Configure frontend Socket.IO URL and backend CORS for the deployed frontend domain (do not leave localhost URLs in production).
- Set the live application URL here after deployment: **Not deployed yet**.

## Important limitations to verify before submission

- Rooms and active socket membership are currently held in server memory; a process restart disconnects users and does not automatically restore an active Host socket from PostgreSQL.
- Test with two separate browser sessions for join approval, roles, removal and playback synchronization before submitting.
