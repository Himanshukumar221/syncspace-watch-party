
import { useEffect, useRef, useState } from "react";
import YouTube from "react-youtube";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("http://localhost:3002", { autoConnect: false });

type Participant = {
  userId: string;
  username: string;
  role: string;
  photo?: string | null;
};

type JoinRequest = {
  userId: string;
  username: string;
  hostPhoto?: string;
};

type RoomData = {
  participants: Participant[];
  videoId: string;
  playState: string;
  currentTime: number;
};

type PlaybackRequest = {
  id: number | string;
  userId: string;
  username: string;
  action: string;
  data?: { time?: number; videoId?: string };
};
type ChatMessage = {
  id: string;
  username: string;
  role: string;
  message: string;
  createdAt: string;
};

function extractVideoId(value: string): string | null {
  const input = value.trim();

  if (/^[\w-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    let id = "";

    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (
      url.hostname.endsWith("youtube.com") ||
      url.hostname.endsWith("youtube-nocookie.com")
    ) {
      id =
        url.searchParams.get("v") ||
        url.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ||
        "";
    }

    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  return `${Math.floor(seconds / 60)}:${String(
    Math.floor(seconds % 60)
  ).padStart(2, "0")}`;
}

export default function App() {
  const playerRef = useRef<any>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState("");
const [chatError, setChatError] = useState("");
const [hostPhoto, setHostPhoto] = useState("");
const [newRoomName, setNewRoomName] = useState("");
const [hostPhotoName, setHostPhotoName] = useState("");

  const [username, setUsername] = useState("");
  const [screen, setScreen] = useState<"home" | "create" | "join">("home");
  const [roomCode, setRoomCode] = useState("");
  const [activeRoom, setActiveRoom] = useState("");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [actionRequests, setActionRequests] = useState<PlaybackRequest[]>([]);
  const [message, setMessage] = useState(
    "Create a room or join your friends."
  );
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const onRoomUpdated = (data: RoomData) => {
      setRoom(data);
    };

    const onChatMessage = (data: ChatMessage) => {
  setChatMessages((previous) => [...previous, data].slice(-100));
};

const onPlaybackSync = (data: {
  action: string;
  videoId: string;
  currentTime: number;
  playState: string;
}) => {
  const player = playerRef.current;

  if (!player) {
    console.warn("YouTube player is not ready yet.");
    return;
  }

  try {
    if (data.action === "play") {
      player.playVideo();
    } else if (data.action === "pause") {
      player.pauseVideo();
    } else if (data.action === "seek") {
      player.seekTo(data.currentTime, true);
    } else if (data.action === "sync") {
      const current = player.getCurrentTime();

      if (Math.abs(current - data.currentTime) > 2) {
        player.seekTo(data.currentTime, true);
      }

      if (data.playState === "playing") {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } else if (data.action === "change_video") {
      if (!data.videoId) {
        console.error("Video ID is missing.");
        return;
      }

      player.loadVideoById(data.videoId);
      setCurrentTime(0);
    }
  } catch (error) {
    console.error("Playback sync failed:", error);
  }
};


    const onRequestsUpdated = (data: JoinRequest[]) => {
      setRequests(data);
    };

    const onActionRequestsUpdated = (data: PlaybackRequest[]) => {
      setActionRequests(data || []);
    };

    const onPlaybackRequestResult = (data: { message: string }) => {
      setMessage(data.message);
    };

    const onJoinApproved = (data: {
      roomId: string;
      videoId: string;
      currentTime: number;
      playState: string;
    }) => {
      setActiveRoom(data.roomId);
      setRoomCode(data.roomId);
      setMessage("Your request was approved! Welcome to the watch party.");
    };

    const onJoinRejected = (reason: string) => {
      setBusy(false);
      setMessage(reason);
    };

    const onRemoved = (reason: string) => {
      setActiveRoom("");
      setRoom(null);
      setRequests([]);
      setMessage(reason);
    };

    const onActionRejected = (reason: string) => {
      setMessage(reason);
    };

    socket.on("room_updated", onRoomUpdated);

    socket.on("chat_message", onChatMessage);
    socket.on("playback_sync", onPlaybackSync);
    socket.on("join_requests_updated", onRequestsUpdated);
    socket.on("action_requests_updated", onActionRequestsUpdated);
    socket.on("playback_request_result", onPlaybackRequestResult);
    socket.on("join_approved", onJoinApproved);
    socket.on("join_rejected", onJoinRejected);
    socket.on("removed_from_room", onRemoved);
    socket.on("action_rejected", onActionRejected);

    socket.connect();

    return () => {
      socket.off("chat_message", onChatMessage);
      socket.off("room_updated", onRoomUpdated);
      socket.off("playback_sync", onPlaybackSync);
      socket.off("join_requests_updated", onRequestsUpdated);
      socket.off("action_requests_updated", onActionRequestsUpdated);
      socket.off("playback_request_result", onPlaybackRequestResult);
      socket.off("join_approved", onJoinApproved);
      socket.off("join_rejected", onJoinRejected);
      socket.off("removed_from_room", onRemoved);
      socket.off("action_rejected", onActionRejected);
      socket.disconnect();
    };
  }, []);


  const myRole =
    room?.participants.find((p) => p.userId === socket.id)?.role || "";

  const canControl = myRole === "Host" || myRole === "Moderator";
  const canApproveActions = canControl;
  const isHost = myRole === "Host";

  useEffect(() => {
    if (!activeRoom) return;

    let tick = 0;

    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const time = player.getCurrentTime?.() || 0;
      const videoDuration = player.getDuration?.() || 0;

      setCurrentTime(time);
      setDuration(videoDuration);

      tick += 1;

      if (
        tick % 2 === 0 &&
        canControl &&
        room?.playState === "playing"
      ) {
        socket.emit("playback_progress", { time });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeRoom, canControl, room?.playState]);
    function createRoom() {

  
    if (!username.trim()) {
      setMessage("Please enter your display name first.");
      return;
    }

    if (!newRoomName.trim()) {
      setMessage("Please enter a room name.");
      return;
    }

    if (!hostPhoto) {
      setMessage("Please upload your profile photo.");
      return;
    }


    setBusy(true);

    socket.emit(
      "create_room",
     {
  username: username.trim(),
  roomName: newRoomName.trim(),
  hostPhoto,
},
      (response: { roomId?: string; error?: string }) => {
        setBusy(false);

        if (response.error || !response.roomId) {
          setMessage(response.error || "Could not create room.");
          return;
        }

        setActiveRoom(response.roomId);
        setRoomCode(response.roomId);
        setMessage("Your watch party is ready!");
      }
    );
  }

  function joinRoom() {
    if (!username.trim() || !roomCode.trim()) {
      setMessage("Enter your name and room code.");
      return;
    }

    setBusy(true);

    socket.emit(
      "join_room",
      { username: username.trim(), roomId: roomCode.trim() },
      (response: {
        pending?: boolean;
        message?: string;
        error?: string;
      }) => {
        setBusy(false);

        if (response.error) {
          setMessage(response.error);
          return;
        }

        if (response.pending) {
          setMessage(response.message || "Waiting for Host approval...");
        }
      }
    );
  }

  function approveParticipant(userId: string) {
    socket.emit(
      "approve_participant",
      { userId },
      (response: { success?: boolean; error?: string }) => {
        if (response.error) setMessage(response.error);
        else setMessage("Participant approved.");
      }
    );
  }

  function rejectParticipant(userId: string) {
    socket.emit(
      "reject_participant",
      { userId },
      (response: { success?: boolean; error?: string }) => {
        if (response.error) setMessage(response.error);
        else setMessage("Join request rejected.");
      }
    );
  }

  function changeRole(userId: string, role: string) {
    socket.emit(
      "set_participant_role",
      { userId, role },
      (response: { success?: boolean; error?: string }) => {
        if (response.error) setMessage(response.error);
        else setMessage(`Participant role updated to ${role}.`);
      }
    );
  }

  function removeParticipant(userId: string) {
    socket.emit(
      "remove_participant",
      { userId },
      (response: { success?: boolean; error?: string }) => {
        if (response.error) setMessage(response.error);
        else setMessage("Participant removed from the room.");
      }
    );
  }

  function requestPlaybackAction(action: string, data: { time?: number; videoId?: string } = {}) {
    socket.emit("request_playback_action", { action, data }, (response: { success?: boolean; message?: string; error?: string }) => {
      setMessage(response.error || response.message || "Playback request sent.");
    });
  }

  function reviewPlaybackAction(requestId: number | string, approved: boolean) {
    socket.emit("review_playback_action", { requestId, approved }, (response: { success?: boolean; error?: string }) => {
      setMessage(response.error || (approved ? "Playback request approved." : "Playback request declined."));
    });
  }

  function changeVideo() {
    const id = extractVideoId(videoUrl);

    if (!id) {
      setMessage("Please enter a valid YouTube video URL or video ID.");
      return;
    }

    socket.emit("change_video", { videoId: id });
    setVideoUrl("");
  }

  function seekTo(value: number) {
    setCurrentTime(value);
    socket.emit("seek", { time: value });
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(activeRoom);
      setMessage("Room code copied!");
    } catch {
      setMessage(`Share this room code: ${activeRoom}`);
    }
  }
  function sendChatMessage() {
  const text = chatInput.trim();

  if (!text) return;

  if (!activeRoom) {
    setChatError("Join a room before sending messages.");
    return;
  }

  socket.emit(
    "chat_send",
    { message: text },
    (response: { success?: boolean; error?: string } = {}) => {
      if (response.error) {
        setChatError(response.error);
        return;
      }

      setChatError("");
      setChatInput("");
    }
  );
}

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-icon">▶</span>
          <span>
            Sync<span className="brand-accent">Space</span>
          </span>
        </a>

        <span className="live-pill">
          <span /> REAL-TIME WATCH PARTY
        </span>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          YOUR PEOPLE. YOUR VIDEOS. ONE SPACE.
        </div>

        <h1>
          Watch together.
          <br />
          <span>Feel closer.</span>
        </h1>

        <p className="hero-description">
          Create a room, invite your friends, and experience videos together
          wherever life takes you.
        </p>

{!activeRoom && (
  <div className="workspace">
    {screen === "home" && (
      <div className="home-actions">
        <div className="home-welcome">
          <div className="home-orbit">▶</div>
          <span className="home-kicker">YOUR PRIVATE WATCH PARTY</span>
          <h2>Every moment is better <span>together.</span></h2>
          <p>
            Bring your favorite people into one room.
            Watch videos together, wherever you are.
          </p>
        </div>

        <div className="home-action-grid">
          <button
            className="home-action-card create-action"
            onClick={() => setScreen("create")}
          >
            <span className="home-card-icon">✦</span>
            <span className="home-card-title">Create a Room</span>
            <span className="home-card-description">
              Start a watch party and invite your friends.
            </span>
            <span className="home-card-arrow">↗</span>
          </button>

          <button
            className="home-action-card join-action"
            onClick={() => setScreen("join")}
          >
            <span className="home-card-icon">⌁</span>
            <span className="home-card-title">Join a Room</span>
            <span className="home-card-description">
              Have a room code? Join your friends.
            </span>
            <span className="home-card-arrow">→</span>
          </button>
        </div>

        <div className="home-feature-row">
          <span>✦ Real-time sync</span>
          <span>✦ Private rooms</span>
          <span>✦ Watch together</span>
        </div>
      </div>
    )}

    {screen === "create" && (
      <section className="panel form-screen">
        <button
          className="back-button"
          onClick={() => setScreen("home")}
        >
          ← Back to Home
        </button>

        <div className="panel-icon">✦</div>
        <h2>Create your room</h2>
        <p className="panel-description">
          Start your own watch party. You will be the Host.
        </p>

        <label htmlFor="username-create">YOUR DISPLAY NAME</label>
        <input
          id="username-create"
          placeholder="Enter your name"
          value={username}
          maxLength={30}
          onChange={(e) => setUsername(e.target.value)}
        />

        
        <label htmlFor="new-room-name">ROOM NAME</label>
        <input
          id="new-room-name"
          placeholder="e.g. Friday Movie Night"
          value={newRoomName}
          maxLength={60}
          onChange={(e) => setNewRoomName(e.target.value)}
        />

        <label htmlFor="host-photo">HOST PROFILE PHOTO</label>
        <input
          id="host-photo"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            if (file.size > 2 * 1024 * 1024) {
              setMessage("Photo must be smaller than 2 MB.");
              e.target.value = "";
              return;
            }

            const reader = new FileReader();

            reader.onload = () => {
              if (typeof reader.result === "string") {
                setHostPhoto(reader.result);
                setHostPhotoName(file.name);
                setMessage("");
              }
            };

            reader.readAsDataURL(file);
          }}
        />

        {hostPhoto && (
          <div className="profile-preview">
            <img
              src={hostPhoto}
              alt="Host profile"
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
            <span>{hostPhotoName}</span>
          </div>
        )}


        <button
          className="primary-button"
          onClick={createRoom}
          disabled={busy || !!activeRoom}
        >
          {busy ? "Creating room..." : "Create Watch Party"} <span>↗</span>
        </button>

        <div className="secure-note">
          ✧ Your room, your rules
        </div>
      </section>
    )}

    {screen === "join" && (
      <section className="panel form-screen">
        <button
          className="back-button"
          onClick={() => setScreen("home")}
        >
          ← Back to Home
        </button>

        <div className="panel-icon join-icon">⌁</div>
        <h2>Join your friends</h2>
        <p className="panel-description">
          Enter your details and request access to their watch party.
        </p>

        <label htmlFor="username-join">YOUR DISPLAY NAME</label>
        <input
          id="username-join"
          placeholder="Enter your name"
          value={username}
          maxLength={30}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label htmlFor="room-code">ROOM CODE</label>
        <input
          id="room-code"
          className="code-input"
          placeholder="e.g. A7K2PQ"
          value={roomCode}
          maxLength={12}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        />

        <button
          className="secondary-button"
          onClick={joinRoom}
          disabled={busy || !!activeRoom}
        >
          {busy ? "Sending request..." : "Request to Join"} <span>→</span>
        </button>

        <div className="secure-note">
          ✧ The Host must approve your request
        </div>
      </section>
    )}
  </div>
)}

        <p className="status-message" role="status">
          {message}
        </p>

        {activeRoom && (
          <section className="room-card">
            <div>
              <span className="room-label">YOUR ROOM CODE</span>
              <h2>{activeRoom}</h2>
              <p>Share this code with your friends.</p>
              <button
                className="secondary-button copy-button"
                onClick={copyRoomCode}
              >
                Copy room code
              </button>
            </div>

            {isHost && (
              <div className="participant-section">
                <h3>Pending join requests ({requests.length})</h3>

                {requests.length === 0 ? (
                  <p>No pending requests right now.</p>
                ) : (
                  requests.map((request) => (
                    <div className="participant" key={request.userId}>
                   <div className="avatar">
  {request.hostPhoto ? (
    <img
      src={request.hostPhoto}
      alt={request.username}
      className="avatar-image"
    />
  ) : (
    request.username.charAt(0).toUpperCase()
  )}
</div>

                      <span>{request.username}</span>

                      <button
                        className="secondary-button"
                        onClick={() => approveParticipant(request.userId)}
                      >
                        Approve
                      </button>

                      <button
                        className="secondary-button"
                        onClick={() => rejectParticipant(request.userId)}
                      >
                        Reject
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {canApproveActions && (
              <div className="participant-section">
                <h3>Playback approval requests ({actionRequests.length})</h3>
                {actionRequests.length === 0 ? (
                  <p>No playback requests right now.</p>
                ) : actionRequests.map((request) => (
                  <div className="participant" key={request.id}>
                    <span><strong>{request.username}</strong> requested <strong>{request.action}</strong>{request.action === "seek" ? ` to ${formatTime(request.data?.time || 0)}` : ""}</span>
                    <button className="secondary-button" onClick={() => reviewPlaybackAction(request.id, true)}>Approve</button>
                    <button className="secondary-button" onClick={() => reviewPlaybackAction(request.id, false)}>Reject</button>
                  </div>
                ))}
              </div>
            )}

            <div className="participant-section">
              <h3>People in your room ({room?.participants.length || 0})</h3>

              {room?.participants.map((person) => (
                <div className="participant" key={person.userId}>
                  
<div className="avatar">
  {person.photo ? (
    <img
      src={person.photo}
      alt={person.username}
      className="avatar-image"
    />
  ) : (
    person.username.charAt(0).toUpperCase()
  )}
</div>


                  <span>{person.username}</span>
                  <span className="role-tag">{person.role}</span>

                  {isHost && person.role !== "Host" && (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          changeRole(
                            person.userId,
                            person.role === "Moderator"
                              ? "Participant"
                              : "Moderator"
                          )
                        }
                      >
                        {person.role === "Moderator"
                          ? "Remove Moderator"
                          : "Make Moderator"}
                      </button>

                      <button
                        className="secondary-button"
                        onClick={() => removeParticipant(person.userId)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="video-section">
              <div className="video-heading">
                <div>
                  <span className="room-label">NOW WATCHING</span>
                  <h3>Shared video player</h3>
                </div>

                <span className="role-tag">{myRole || "Connecting..."}</span>
              </div>

              <div className="youtube-frame">
  {room?.videoId ? (
    <YouTube
      key={room.videoId}
      videoId={room.videoId}
      className="youtube-player"
      iframeClassName="youtube-iframe"
      opts={{
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          playsinline: 1,
          fs: 1,
        },
      }}
      onReady={(event) => {
        playerRef.current = event.target;
        setDuration(event.target.getDuration() || 0);
      }}
      onEnd={() => {
        setCurrentTime(0);
      }}
     onError={(event) => {
  console.error("YouTube Player Error:", event.data);

  setMessage(
    `YouTube video error: ${event.data}. Try another YouTube URL.`
  );
}}
    />
  ) : (
    <div className="video-placeholder">
      <span className="placeholder-icon">▶</span>
      <h3>Ready for movie night?</h3>
      <p>Waiting for the Host to add a YouTube video.</p>
    </div>
  )}
</div>

              <div className="player-controls">
                <div className="playback-buttons">
                  <button
                    className="secondary-button"
                    disabled={!canControl && myRole !== "Participant"}
                    onClick={() => canControl ? socket.emit("play") : requestPlaybackAction("play")}
                  >
                    ▶ {canControl ? "Play" : "Request Play"}
                  </button>

                  <button
                    className="secondary-button"
                    disabled={!canControl && myRole !== "Participant"}
                    onClick={() => canControl ? socket.emit("pause") : requestPlaybackAction("pause")}
                  >
                    ⏸ {canControl ? "Pause" : "Request Pause"}
                  </button>
                </div>

                <div className="seek-row">
                  <span>{formatTime(currentTime)}</span>

                  <input
                    aria-label="Seek video"
                    type="range"
                    min={0}
                    max={Math.max(duration, 1)}
                    step={1}
                    value={Math.min(currentTime, duration || currentTime)}
                    disabled={(!canControl && myRole !== "Participant") || duration <= 0}
                    onChange={(e) => setCurrentTime(Number(e.target.value))}
                    onMouseUp={(e) => canControl ? seekTo(Number(e.currentTarget.value)) : requestPlaybackAction("seek", { time: Number(e.currentTarget.value) })}
                    onTouchEnd={(e) => canControl ? seekTo(Number(e.currentTarget.value)) : requestPlaybackAction("seek", { time: Number(e.currentTarget.value) })}
                  />

                  <span>{formatTime(duration)}</span>
                </div>

                {!canControl && (
                  <p className="next-step-note">
                    Ask the Host to give you playback permissions.
                  </p>
                )}

                {isHost && (
  <>
    <label htmlFor="youtube-url">CHANGE YOUTUBE VIDEO</label>

    <div className="video-url-row">
      <input
        id="youtube-url"
        placeholder="Paste a YouTube URL"
        value={videoUrl}
        onChange={(e) => setVideoUrl(e.target.value)}
      />

      <button
        className="primary-button"
        onClick={changeVideo}
      >
        Load video
      </button>
    </div>
  </>
)}
              </div>
            </div>
            
            <div className="chat-panel">
              <h3>💬 Room Chat</h3>

              <div className="chat-messages">
                {chatMessages.length === 0 ? (
                  <p>No messages yet. Say hello!</p>
                ) : (
                  chatMessages.map((chat) => (
                    <div className="chat-message" key={chat.id}>
                      <strong>{chat.username}</strong>
                      <span className="role-tag">{chat.role}</span>
                      <p>{chat.message}</p>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChatMessage();
                }}
                className="chat-input-row"
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type your message..."
                  maxLength={500}
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!chatInput.trim()}
                >
                  Send
                </button>
              </form>

              {chatError && <p className="chat-error">{chatError}</p>}
            </div>

          </section>
        )}
      </section>

      <footer className="footer">
        <span>© 2026 SyncSpace</span>
        <span>Made for moments shared together ✦</span>
      </footer>
    </main>
  );
};
