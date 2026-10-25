
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const db = require("./db");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());


const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://syncspace-watch-party.vercel.app"
    ],
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();
const DEFAULT_VIDEO = "";


app.get("/", (req, res) => {
  res.json({ message: "SyncSpace API is running!" });
});

function getRoom(socket) {
  const roomId = socket.data.roomId;
  const room = rooms.get(roomId);

  if (!room) return null;

  const participant = room.participants.find(
    (p) => p.userId === socket.id
  );

  if (!participant) return null;

  return { roomId, room, participant };
}


function sendRoomUpdate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participants = room.participants.map((person) => ({
    ...person,
    photo:
      person.photo ||
      (person.role === "Host" ? room.hostPhoto : null),
  }));

  io.to(roomId).emit("room_updated", {
    roomName: room.roomName,
    hostPhoto: room.hostPhoto,
    participants,
    videoId: room.videoId,
    playState: room.playState,
    currentTime: room.currentTime,
  });
}


function sendJoinRequests(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const host = room.participants.find((p) => p.role === "Host");
  if (host) {
    io.to(host.userId).emit("join_requests_updated", room.pendingRequests);
    io.to(host.userId).emit("action_requests_updated", room.pendingActionRequests || []);
  }
}

function requireHost(socket) {
  const result = getRoom(socket);

  if (!result || result.participant.role !== "Host") {
    socket.emit("action_rejected", "Only the Host can perform this action.");
    return null;
  }

  return result;
}

function requirePlaybackPermission(socket) {
  const result = getRoom(socket);

  if (
    !result ||
    !["Host", "Moderator"].includes(result.participant.role)
  ) {
    socket.emit(
      "action_rejected",
      "Only the Host or Moderator can control playback."
    );
    return null;
  }

  return result;
}

async function broadcastPlayback(socket, action, extra = {}) {
  const result = requirePlaybackPermission(socket);
  if (!result) return;

  const { roomId, room } = result;

  if (action === "play") room.playState = "playing";
  if (action === "pause") room.playState = "paused";

  if (action === "seek") {
    room.currentTime = extra.time;
  }

  if (action === "change_video") {
    room.videoId = extra.videoId;
    room.currentTime = 0;
    room.playState = "paused";
  }

  try {
    await db.query(
      `UPDATE rooms
       SET video_id = $1,
           is_playing = $2,
           current_time_seconds = $3,
           updated_at = NOW()
       WHERE room_code = $4`,
      [room.videoId, room.playState === "playing", room.currentTime, roomId]
    );
  } catch (error) {
    console.error("Save playback state error:", error.message);
    socket.emit("action_rejected", "Playback changed but could not be saved to the database.");
  }

  io.to(roomId).emit("playback_sync", {
    action,
    videoId: room.videoId,
    currentTime: room.currentTime,
    playState: room.playState,
  });

  sendRoomUpdate(roomId);
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  
socket.on(
  "create_room",
  async ({ username, roomName, hostPhoto } = {}, callback) => {
  try {
    if (socket.data.roomId) {
      return callback?.({ error: "You are already in a room." });
    }

    if (typeof username !== "string" || !username.trim()) {
      return callback?.({ error: "Username is required." });
    }
    if (typeof roomName !== "string" || !roomName.trim()) {
  return callback?.({ error: "Room name is required." });
}

if (typeof hostPhoto !== "string" || !hostPhoto.startsWith("data:image/")) {
  return callback?.({ error: "Please upload a valid host profile photo." });
}

    let roomId;

    do {
      roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (rooms.has(roomId));

    const cleanUsername = username.trim().slice(0, 30);

await db.query(
  `INSERT INTO rooms
    (room_code, host_username, room_name, host_photo,
     video_id, is_playing, current_time_seconds)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [
    roomId,
    cleanUsername,
    roomName.trim().slice(0, 100),
    hostPhoto,
    DEFAULT_VIDEO,
    false,
    0
  ]
);
await db.query(
  `INSERT INTO participants (room_id, username, role)
   SELECT id, $1, $2
   FROM rooms
   WHERE room_code = $3`,
  [cleanUsername, "Host", roomId]
);


const room = {
  roomName: roomName.trim().slice(0, 100),
  hostPhoto: hostPhoto,

  participants: [
    {
      userId: socket.id,
      username: cleanUsername,
      role: "Host",
      photo: hostPhoto,
    },
  ],

  pendingRequests: [],
  pendingActionRequests: [],
  videoId: null,
  playState: "paused",
  currentTime: 0,
};


    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;

    callback?.({ roomId });
    sendRoomUpdate(roomId);
  } catch (error) {
    console.error("Create room error:", error.message);
    callback?.({ error: "Could not create room. Please try again." });
  }
});

  // New users request entry; Host must approve them.
  socket.on("join_room", ({ roomId, username } = {}, callback) => {
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);

    if (!room) {
      return callback?.({ error: "Room not found. Check the room code." });
    }

    if (socket.data.roomId) {
      return callback?.({ error: "Leave your current room first." });
    }

    if (typeof username !== "string" || !username.trim()) {
      return callback?.({ error: "Username is required." });
    }

    if (room.pendingRequests.some((r) => r.userId === socket.id)) {
      return callback?.({ error: "Your request is already pending." });
    }

    room.pendingRequests.push({
      userId: socket.id,
      username: username.trim().slice(0, 30),
    });

    socket.data.requestedRoomId = id;

    callback?.({
      pending: true,
      message: "Join request sent. Wait for Host approval.",
    });

    sendJoinRequests(id);
  });

  socket.on("approve_participant", async ({ userId } = {}, callback) => {
    const result = requireHost(socket);
    if (!result) return;

    const { roomId, room } = result;
    const requestIndex = room.pendingRequests.findIndex(
      (r) => r.userId === userId
    );

    if (requestIndex === -1) {
      return callback?.({ error: "Join request not found." });
    }

    const request = room.pendingRequests[requestIndex];
    const target = io.sockets.sockets.get(userId);

    if (!target || target.data.requestedRoomId !== roomId) {
      room.pendingRequests.splice(requestIndex, 1);
      sendJoinRequests(roomId);
      return callback?.({ error: "User is no longer connected." });
    }

    room.pendingRequests.splice(requestIndex, 1);

    try {
  const dbResult = await db.query(
    `INSERT INTO participants (room_id, username, role)
     SELECT id, $1, $2
     FROM rooms
     WHERE room_code = $3
     ON CONFLICT (room_id, username)
     DO UPDATE SET
       role = EXCLUDED.role,
       is_connected = TRUE`,
    [request.username, "Participant", roomId]
  );

  if (dbResult.rowCount === 0) {
    return callback?.({
      error: "Room was not found in the database.",
    });
  }
} catch (error) {
  console.error("Save participant error:", error.message);
  return callback?.({
    error: "Could not save participant. Please try again.",
  });
}

    const participant = {
      userId,
      username: request.username,
      role: "Participant",
    };

    room.participants.push(participant);
    target.join(roomId);
    target.data.roomId = roomId;
    delete target.data.requestedRoomId;

    target.emit("join_approved", {
      roomId,
      participant,
      videoId: room.videoId,
      currentTime: room.currentTime,
      playState: room.playState,
    });

    callback?.({ success: true });
    sendJoinRequests(roomId);
    sendRoomUpdate(roomId);

    target.emit("playback_sync", {
      action: "sync",
      videoId: room.videoId,
      currentTime: room.currentTime,
      playState: room.playState,
    });
  });

  socket.on("reject_participant", ({ userId } = {}, callback) => {
    const result = requireHost(socket);
    if (!result) return;

    const { roomId, room } = result;
    const index = room.pendingRequests.findIndex(
      (r) => r.userId === userId
    );

    if (index === -1) {
      return callback?.({ error: "Join request not found." });
    }

    const target = io.sockets.sockets.get(userId);
    room.pendingRequests.splice(index, 1);

    if (target) {
      delete target.data.requestedRoomId;
      target.emit("join_rejected", "The Host declined your request.");
    }

    callback?.({ success: true });
    sendJoinRequests(roomId);
  });

  socket.on("set_participant_role", async ({ userId, role } = {}, callback) => {
    const result = requireHost(socket);
    if (!result) return;

    if (!["Moderator", "Participant"].includes(role)) {
      return callback?.({ error: "Invalid role." });
    }

    const target = result.room.participants.find(
      (p) => p.userId === userId
    );

    if (!target || target.role === "Host") {
      return callback?.({ error: "Participant not found or cannot edit Host." });
    }

    try {
      const dbResult = await db.query(
        `UPDATE participants p
         SET role = $1
         FROM rooms r
         WHERE p.room_id = r.id
           AND r.room_code = $2
           AND p.username = $3`,
        [role, result.roomId, target.username]
      );
      if (dbResult.rowCount === 0) {
        return callback?.({ error: "Participant was not found in the database." });
      }
    } catch (error) {
      console.error("Save participant role error:", error.message);
      return callback?.({ error: "Could not save the role change." });
    }

    target.role = role;
    callback?.({ success: true });
    sendRoomUpdate(result.roomId);
  });

  socket.on("remove_participant", async ({ userId } = {}, callback) => {
    const result = requireHost(socket);
    if (!result) return;

    const { roomId, room } = result;
    const target = room.participants.find((p) => p.userId === userId);

    if (!target || target.role === "Host") {
      return callback?.({ error: "Participant not found or cannot remove Host." });
    }

    try {
      await db.query(
        `UPDATE participants p
         SET is_connected = FALSE
         FROM rooms r
         WHERE p.room_id = r.id
           AND r.room_code = $1
           AND p.username = $2`,
        [roomId, target.username]
      );
    } catch (error) {
      console.error("Save participant removal error:", error.message);
      return callback?.({ error: "Could not save participant removal." });
    }

    room.participants = room.participants.filter(
      (p) => p.userId !== userId
    );

    const targetSocket = io.sockets.sockets.get(userId);

    if (targetSocket) {
      targetSocket.leave(roomId);
      delete targetSocket.data.roomId;
      targetSocket.emit("removed_from_room", "The Host removed you from this room.");
    }

    callback?.({ success: true });
    sendRoomUpdate(roomId);
  });

  // Participants can ask the Host/Moderator to approve a playback action.
  socket.on("request_playback_action", async ({ action, data = {} } = {}, callback) => {
    const result = getRoom(socket);
    if (!result) return callback?.({ error: "Join a room first." });
    if (result.participant.role !== "Participant") {
      return callback?.({ error: "Only Participants need to request playback approval." });
    }
    if (!["play", "pause", "seek", "change_video"].includes(action)) {
      return callback?.({ error: "Unsupported playback action." });
    }
    if (action === "seek" && (!Number.isFinite(data.time) || data.time < 0)) {
      return callback?.({ error: "Invalid seek position." });
    }
    if (action === "change_video" && (typeof data.videoId !== "string" || !/^[\w-]{11}$/.test(data.videoId))) {
      return callback?.({ error: "Enter a valid YouTube video ID." });
    }

    try {
      const saved = await db.query(
        `INSERT INTO approval_requests (room_id, requester_username, action_type, request_data)
         SELECT id, $2, $3, $4::jsonb FROM rooms WHERE room_code = $1 RETURNING id`,
        [result.roomId, result.participant.username, action, JSON.stringify(data)]
      );
      if (!saved.rowCount) return callback?.({ error: "Room was not found in the database." });
      const request = {
        id: saved.rows[0].id,
        userId: socket.id,
        username: result.participant.username,
        action,
        data,
      };
      result.room.pendingActionRequests ||= [];
      result.room.pendingActionRequests.push(request);
      const approvers = result.room.participants.filter((p) => ["Host", "Moderator"].includes(p.role));
      for (const approver of approvers) io.to(approver.userId).emit("action_requests_updated", result.room.pendingActionRequests);
      callback?.({ success: true, message: "Action request sent for approval." });
    } catch (error) {
      console.error("Create playback approval request error:", error.message);
      callback?.({ error: "Could not save your request." });
    }
  });

  socket.on("review_playback_action", async ({ requestId, approved } = {}, callback) => {
    const result = getRoom(socket);
    if (!result || !["Host", "Moderator"].includes(result.participant.role)) {
      return callback?.({ error: "Only the Host or Moderator can review requests." });
    }
    const { roomId, room, participant: reviewer } = result;
    const index = (room.pendingActionRequests || []).findIndex((r) => String(r.id) === String(requestId));
    if (index < 0) return callback?.({ error: "Action request not found." });
    const request = room.pendingActionRequests[index];
    try {
      await db.query(
        `UPDATE approval_requests ar SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         FROM rooms r WHERE ar.room_id = r.id AND r.room_code = $3 AND ar.id = $4`,
        [approved ? "approved" : "rejected", reviewer.username, roomId, request.id]
      );
    } catch (error) {
      console.error("Review playback approval error:", error.message);
      return callback?.({ error: "Could not save approval decision." });
    }
    room.pendingActionRequests.splice(index, 1);
    if (approved) {
      const actionData = request.action === "seek" ? { time: request.data.time } :
        request.action === "change_video" ? { videoId: request.data.videoId } : {};
      await broadcastPlayback(socket, request.action, actionData);
    }
    io.to(request.userId).emit("playback_request_result", {
      approved: Boolean(approved), action: request.action,
      message: approved ? "Your playback action was approved." : "Your playback action was declined."
    });
    const approvers = room.participants.filter((p) => ["Host", "Moderator"].includes(p.role));
    for (const approver of approvers) io.to(approver.userId).emit("action_requests_updated", room.pendingActionRequests);
    callback?.({ success: true });
  });

  socket.on("play", () => { void broadcastPlayback(socket, "play"); });
  socket.on("pause", () => { void broadcastPlayback(socket, "pause"); });

  socket.on("seek", ({ time } = {}) => {
    if (!Number.isFinite(time) || time < 0) {
      return socket.emit("action_rejected", "Invalid seek position.");
    }

    void broadcastPlayback(socket, "seek", { time });
  });

  
socket.on("playback_progress", ({ time } = {}) => {
  const result = requirePlaybackPermission(socket);
  if (!result) return;

  if (
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(result.room.currentTime)
  ) {
    return;
  }

  // Update the current room's playback position.
  result.room.currentTime = time;
});

  socket.on("change_video", ({ videoId } = {}) => {
    if (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId)) {
      return socket.emit(
        "action_rejected",
        "Enter a valid 11-character YouTube video ID."
      );
    }

    void broadcastPlayback(socket, "change_video", { videoId });
  });

  // Live room chat
socket.on("chat_send", ({ message } = {}, callback) => {
  const result = getRoom(socket);

  if (!result) {
    return callback?.({
      error: "Join a room before sending messages.",
    });
  }

  if (typeof message !== "string" || !message.trim()) {
    return callback?.({
      error: "Message cannot be empty.",
    });
  }

  const cleanMessage = message.trim().slice(0, 500);

  const chatMessage = {
    id: `${Date.now()}-${socket.id}`,
    username: result.participant.username,
    role: result.participant.role,
    message: cleanMessage,
    createdAt: new Date().toISOString(),
  };

  // Send message only to people in this room
  io.to(result.roomId).emit("chat_message", chatMessage);

  callback?.({ success: true });
});

  socket.on("disconnect", async () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    // Clean up pending requests if the user disconnects.
    for (const [id, activeRoom] of rooms) {
      activeRoom.pendingRequests = activeRoom.pendingRequests.filter(
        (request) => request.userId !== socket.id
      );
      sendJoinRequests(id);
    }

    if (!room) return;

    const disconnectedParticipant = room.participants.find(
      (p) => p.userId === socket.id
    );
    if (disconnectedParticipant) {
      try {
        await db.query(
          `UPDATE participants p
           SET is_connected = FALSE
           FROM rooms r
           WHERE p.room_id = r.id
             AND r.room_code = $1
             AND p.username = $2`,
          [roomId, disconnectedParticipant.username]
        );
      } catch (error) {
        console.error("Save disconnect status error:", error.message);
      }
    }

    room.participants = room.participants.filter(
      (p) => p.userId !== socket.id
    );

    if (room.participants.length === 0) {
      rooms.delete(roomId);
      return;
    }

    if (!room.participants.some((p) => p.role === "Host")) {
      room.participants[0].role = "Host";
      try {
        await db.query(
          `UPDATE participants p
           SET role = CASE WHEN p.username = $2 THEN 'Host' ELSE p.role END
           FROM rooms r
           WHERE p.room_id = r.id AND r.room_code = $1`,
          [roomId, room.participants[0].username]
        );
        await db.query(
          `UPDATE rooms SET host_username = $2, updated_at = NOW() WHERE room_code = $1`,
          [roomId, room.participants[0].username]
        );
      } catch (error) {
        console.error("Save host transfer error:", error.message);
      }
    }

    sendRoomUpdate(roomId);
    sendJoinRequests(roomId);
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`SyncSpace server running on http://localhost:${PORT}`);
});
