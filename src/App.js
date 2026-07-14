import React, { useState, useEffect, useRef } from "react";
import Peer from "peerjs";
import {
  Shield,
  Lock,
  Unlock,
  Menu,
  X,
  Send,
  Paperclip,
  Trash2,
  Clock,
  UserPlus,
  Image as ImageIcon,
  Copy,
  Check,
  Phone,
  PhoneOff,
  Video,
  UserX,
} from "lucide-react";

const generateNickname = () => {
  const adjectives = [
    "Shadow",
    "Silent",
    "Quantum",
    "Neon",
    "Cyber",
    "Ghost",
    "Void",
  ];
  const nouns = ["Fox", "Wolf", "Hawk", "Pulse", "Byte", "Echo", "Ninja"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;
};

const simulateCiphertext = (length) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";
  return Array.from({ length: Math.max(12, length) })
    .map(() => chars.charAt(Math.floor(Math.random() * chars.length)))
    .join("");
};

export default function SecureChatApp() {
  const [currentUser, setCurrentUser] = useState({
    id: "",
    name: generateNickname(),
  });
  const [peerInstance, setPeerInstance] = useState(null);
  const [activeConnection, setActiveConnection] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // disconnected, connecting, connected

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callState, setCallState] = useState("idle");
  const [isVideoCall, setIsVideoCall] = useState(false);

  const [rooms, setRooms] = useState([
    { id: "lobby", name: "Trạm chờ kết nối P2P" },
  ]);
  const [currentRoom, setCurrentRoom] = useState("lobby");
  const [messages, setMessages] = useState({ lobby: [] });

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [timerSetting, setTimerSetting] = useState(0);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current && localStream)
      localVideoRef.current.srcObject = localStream;
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream)
      remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, callState]);

  // ==========================================
  // LÕI MẠNG ĐÃ ĐƯỢC TỐI ƯU HÓA CHO 4G/5G
  // ==========================================
  useEffect(() => {
    // Ép buộc trình duyệt sử dụng chuẩn bảo mật WSS để không bị rớt tín hiệu trên Cloudflare
    const peer = new Peer(undefined, {
      secure: true,
      debug: 2,
      config: {
        iceServers: [
          {
            urls: "stun:stun.relay.metered.ca:80",
          },
          {
            urls: "turn:global.relay.metered.ca:80",
            username: "007f172b13f568869488991e",
            credential: "Ia/VNUXBdCJNlagv",
          },
          {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "007f172b13f568869488991e",
            credential: "Ia/VNUXBdCJNlagv",
          },
          {
            urls: "turn:global.relay.metered.ca:443",
            username: "007f172b13f568869488991e",
            credential: "Ia/VNUXBdCJNlagv",
          },
          {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "007f172b13f568869488991e",
            credential: "Ia/VNUXBdCJNlagv",
          },
        ],
      },
    });

    peer.on("open", (id) => {
      setCurrentUser((prev) => ({ ...prev, id: id }));
    });

    peer.on("connection", (conn) => {
      handleIncomingConnection(conn);
    });

    peer.on("call", (incomingCall) => {
      const isVideoRequested = incomingCall.options?.metadata?.video || false;
      setIsVideoCall(isVideoRequested);
      setActiveCall(incomingCall);
      setCallState("receiving");
    });

    peer.on("error", (err) => {
      console.error("Lỗi PeerJS:", err);
      alert(`Lỗi mạng: ${err.message}. Vui lòng thử lại.`);
      setConnectionStatus("disconnected");
    });

    setPeerInstance(peer);
    return () => peer.destroy();
  }, []);

  const handleIncomingConnection = (conn) => {
    setConnectionStatus("connected");
    setActiveConnection(conn);
    const remoteName = conn.metadata?.name || "Đối tác ẩn danh";
    const newRoomId = conn.peer;

    setRooms((prev) => [
      ...prev.filter((r) => r.id !== newRoomId),
      { id: newRoomId, name: `Kênh mật: ${remoteName}` },
    ]);
    setCurrentRoom(newRoomId);

    conn.on("data", (data) => {
      if (data.type === "secure-msg")
        receiveMessageOverWire(newRoomId, data.payload);
      if (data.type === "force-disconnect") handleResetToLobby();
    });

    conn.on("close", () => handleResetToLobby());
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!joinCode.trim() || !peerInstance) return;

    setConnectionStatus("connecting");

    // ĐÃ GỠ BỎ 'reliable: true' ĐỂ TRÁNH KẸT KẾT NỐI TRÊN MẠNG DI ĐỘNG 4G
    const conn = peerInstance.connect(joinCode.trim(), {
      metadata: { name: currentUser.name },
    });

    // Cài đặt đếm ngược: Nếu sau 10 giây không qua được 4G sẽ báo lỗi
    const timeout = setTimeout(() => {
      if (connectionStatus !== "connected") {
        alert(
          "Kết nối quá hạn! Mạng 4G của bạn đang bị nhà mạng chặn P2P gắt gao. Hãy kiểm tra lại TURN Server."
        );
        setConnectionStatus("disconnected");
      }
    }, 10000);

    conn.on("open", () => {
      clearTimeout(timeout);
      setConnectionStatus("connected");
      setActiveConnection(conn);
      const newRoomId = conn.peer;
      setRooms((prev) => [
        ...prev.filter((r) => r.id !== newRoomId),
        { id: newRoomId, name: `Kênh mật: Đối tác` },
      ]);
      setCurrentRoom(newRoomId);

      conn.on("data", (data) => {
        if (data.type === "secure-msg")
          receiveMessageOverWire(newRoomId, data.payload);
        if (data.type === "force-disconnect") handleResetToLobby();
      });
    });

    conn.on("close", () => handleResetToLobby());
    conn.on("error", () => {
      clearTimeout(timeout);
      alert("Không thể kết nối P2P. Mã bị sai hoặc tường lửa chặn.");
      setConnectionStatus("disconnected");
    });

    setJoinCode("");
    setIsSidebarOpen(false);
  };

  const handleStartCall = async (videoEnabled) => {
    if (!activeConnection || connectionStatus !== "connected") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled
          ? { facingMode: "user", width: { ideal: 640 } }
          : false,
        audio: true,
      });
      setLocalStream(stream);
      setIsVideoCall(videoEnabled);
      setCallState("calling");

      const call = peerInstance.call(activeConnection.peer, stream, {
        metadata: { video: videoEnabled },
      });
      setActiveCall(call);

      call.on("stream", (remoteMediaStream) => {
        setCallState("active");
        setRemoteStream(remoteMediaStream);
      });

      call.on("close", () => handleEndCallLocal());
    } catch (err) {
      alert("Lỗi: Trình duyệt chưa cấp quyền Camera/Microphone.");
    }
  };

  const handleAnswerCall = async () => {
    if (!activeCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoCall
          ? { facingMode: "user", width: { ideal: 640 } }
          : false,
        audio: true,
      });
      setLocalStream(stream);
      activeCall.answer(stream);
      setCallState("active");

      activeCall.on("stream", (remoteMediaStream) => {
        setRemoteStream(remoteMediaStream);
      });

      activeCall.on("close", () => handleEndCallLocal());
    } catch (err) {
      handleEndCallLocal();
    }
  };

  const handleEndCallLocal = () => {
    if (activeCall) activeCall.close();
    if (localStream) localStream.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setCallState("idle");
  };

  const handleDisconnectPeer = () => {
    if (window.confirm("Ngắt kết nối với thiết bị đối tác?")) {
      handleEndCallLocal();
      if (activeConnection) {
        try {
          activeConnection.send({ type: "force-disconnect" });
        } catch (e) {}
        activeConnection.close();
      }
      handleResetToLobby();
    }
  };

  const handleResetToLobby = () => {
    handleEndCallLocal();
    setActiveConnection(null);
    setConnectionStatus("disconnected");
    setRooms([{ id: "lobby", name: "Trạm chờ kết nối P2P" }]);
    setCurrentRoom("lobby");
  };

  const receiveMessageOverWire = (roomId, incomingMsg) => {
    const internalMsg = { ...incomingMsg, isDecrypting: true };
    setMessages((prev) => ({
      ...prev,
      [roomId]: [...(prev[roomId] || []), internalMsg],
    }));

    if (internalMsg.expiresAt) {
      internalMsg.expiresAt =
        Date.now() + internalMsg.timerDuration * 1000 + 1500;
    }

    setTimeout(() => {
      setMessages((prev) => {
        const list = prev[roomId] || [];
        return {
          ...prev,
          [roomId]: list.map((m) =>
            m.id === internalMsg.id ? { ...m, isDecrypting: false } : m
          ),
        };
      });
    }, 1500);
  };

  const handleSendMessage = (
    type = "text",
    content = inputText,
    fileDataUrl = null
  ) => {
    if (type === "text" && !content.trim() && !fileDataUrl) return;

    const msgId = Math.random().toString(36).substring(2, 9);
    const cipher = simulateCiphertext(content ? content.length : 24);

    const securePayload = {
      id: msgId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      type: type,
      content: content,
      fileUrl: fileDataUrl,
      timestamp: Date.now(),
      timerDuration: timerSetting,
      expiresAt:
        timerSetting > 0 ? Date.now() + timerSetting * 1000 + 1500 : null,
      cipherText: cipher,
    };

    setMessages((prev) => ({
      ...prev,
      [currentRoom]: [
        ...(prev[currentRoom] || []),
        { ...securePayload, isDecrypting: true },
      ],
    }));
    if (type === "text") setInputText("");

    setTimeout(() => {
      setMessages((prev) => {
        const list = prev[currentRoom] || [];
        return {
          ...prev,
          [currentRoom]: list.map((m) =>
            m.id === msgId ? { ...m, isDecrypting: false } : m
          ),
        };
      });
    }, 1500);

    if (activeConnection && connectionStatus === "connected") {
      try {
        activeConnection.send({ type: "secure-msg", payload: securePayload });
      } catch (err) {}
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert("File quá lớn cho mạng 4G. Tối đa 3MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => handleSendMessage("image", file.name, reader.result);
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        let changed = false;
        const copy = { ...prev };
        Object.keys(copy).forEach((rId) => {
          const oldLen = copy[rId].length;
          copy[rId] = copy[rId].filter(
            (m) => !m.expiresAt || m.expiresAt > now
          );
          if (copy[rId].length !== oldLen) changed = true;
        });
        return changed ? copy : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentRoom]);

  return (
    <div className="flex h-screen w-full bg-gray-900 text-gray-100 font-sans overflow-hidden">
      {/* SIDEBAR BÊN TRÁI */}
      <div
        className={`${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 absolute md:relative z-20 flex flex-col w-72 h-full bg-gray-950 border-r border-gray-800 transition-transform duration-300 ease-in-out`}
      >
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
          <div className="flex items-center gap-2 text-emerald-400">
            <Shield className="w-5 h-5" />
            <span className="font-bold tracking-wider text-sm">
              SECURE NETWORK
            </span>
          </div>
          <button
            className="md:hidden p-1 text-gray-400 hover:text-white"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 m-3 bg-gray-900 border border-gray-800 rounded-lg">
          <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1">
            Mã kết nối của bạn
          </div>
          <div className="flex items-center justify-between bg-gray-950 rounded p-2 border border-gray-800">
            <span className="font-mono text-xs text-emerald-400 select-all truncate mr-2">
              {currentUser.id ? currentUser.id : "Đang lấy ID..."}
            </span>
            {currentUser.id && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentUser.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-gray-400 hover:text-emerald-400"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-semibold text-gray-500 mb-2 px-2 uppercase tracking-widest">
            Thiết bị liên kết
          </div>
          {rooms.map((room) => (
            <div
              key={room.id}
              className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between transition-colors ${
                currentRoom === room.id
                  ? "bg-gray-800 text-white border border-gray-700"
                  : "text-gray-400"
              }`}
            >
              <div className="flex items-center gap-2 truncate text-sm">
                <Lock className="w-3.5 h-3.5 opacity-60" />
                <span className="truncate">{room.name}</span>
              </div>
              {room.id !== "lobby" && (
                <button
                  onClick={handleDisconnectPeer}
                  className="text-gray-400 hover:text-red-400 p-1 rounded transition"
                >
                  <UserX className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 bg-gray-900/50 border-t border-gray-800">
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-500 uppercase">
              Kết nối tới đối tác
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Dán mã P2P ID..."
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button
                type="submit"
                disabled={connectionStatus === "connecting"}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 p-2 rounded text-white shrink-0"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {isSidebarOpen && (
        <div
          className="absolute inset-0 bg-black/60 z-10 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* KHÔNG GIAN HỘI THOẠI */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-900 relative">
        {callState === "receiving" && (
          <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-6 space-y-6">
            <div className="w-20 h-20 bg-emerald-600/20 border-2 border-emerald-500 rounded-full flex items-center justify-center text-emerald-400 animate-bounce">
              {isVideoCall ? (
                <Video className="w-10 h-10" />
              ) : (
                <Phone className="w-10 h-10" />
              )}
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white">Cuộc gọi đến...</h3>
              <p className="text-xs text-gray-400 mt-1">
                Yêu cầu {isVideoCall ? "Video Call" : "Gọi thoại"}
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleAnswerCall}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
              >
                <Phone className="w-4 h-4" /> Chấp nhận
              </button>
              <button
                onClick={handleEndCallLocal}
                className="bg-red-600 hover:bg-red-500 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
              >
                <PhoneOff className="w-4 h-4" /> Từ chối
              </button>
            </div>
          </div>
        )}

        {/* Header Chat */}
        <div className="h-14 border-b border-gray-800 flex justify-between items-center px-4 bg-gray-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden text-gray-400 hover:text-white"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="truncate">
              <div className="font-semibold text-sm flex items-center gap-2 truncate">
                <Unlock
                  className={`w-3.5 h-3.5 ${
                    connectionStatus === "connected"
                      ? "text-emerald-400"
                      : "text-gray-500"
                  }`}
                />
                {rooms.find((r) => r.id === currentRoom)?.name}
              </div>
              <div className="text-[10px] text-gray-500">
                {connectionStatus === "connecting"
                  ? "Đang vượt tường lửa 4G/5G..."
                  : ""}
              </div>
            </div>
          </div>

          {currentRoom !== "lobby" && connectionStatus === "connected" && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleStartCall(false)}
                disabled={callState !== "idle"}
                className="p-2 text-gray-400 hover:text-emerald-400 hover:bg-gray-800 rounded-md transition"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleStartCall(true)}
                disabled={callState !== "idle"}
                className="p-2 text-gray-400 hover:text-emerald-400 hover:bg-gray-800 rounded-md transition"
              >
                <Video className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Khung Video */}
        {["calling", "active"].includes(callState) && (
          <div className="bg-black border-b border-gray-800 p-3 relative flex justify-center items-center shrink-0">
            {callState === "calling" ? (
              <div className="h-32 flex flex-col items-center justify-center text-gray-400">
                <Phone className="w-8 h-8 animate-pulse text-emerald-500 mb-2" />
                <span className="text-xs">Đang đổ chuông...</span>
              </div>
            ) : (
              <div className="relative w-full max-w-xl h-48 sm:h-64 bg-gray-950 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center">
                {isVideoCall ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Phone className="w-12 h-12 animate-pulse text-emerald-400" />
                )}
                {isVideoCall && localStream && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute bottom-2 right-2 w-20 h-28 object-cover rounded-lg border border-gray-700 bg-gray-900 z-10"
                  />
                )}
              </div>
            )}
            <button
              onClick={handleEndCallLocal}
              className="absolute bottom-4 bg-red-600 text-white p-3 rounded-full shadow-2xl z-20"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Danh sách Tin nhắn */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {currentRoom === "lobby" ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Shield className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="font-bold text-sm text-gray-200">
                Đã kích hoạt tối ưu Mobile 4G
              </h3>
              <p className="text-xs text-gray-400">
                Hãy dùng máy tính (Wi-Fi) gửi mã P2P sang điện thoại (4G) và bấm
                kết nối.
              </p>
            </div>
          ) : (
            <>
              {(messages[currentRoom] || []).map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-1.5 relative ${
                        isMe
                          ? "bg-emerald-900/50 text-emerald-50 border border-emerald-800/40 rounded-tr-sm"
                          : "bg-gray-800 text-gray-100 border border-gray-700 rounded-tl-sm"
                      }`}
                    >
                      {msg.isDecrypting ? (
                        <div className="flex items-center gap-2 font-mono text-[11px] opacity-60">
                          <Lock className="w-3 h-3 animate-pulse text-emerald-400" />
                          <span className="break-all">{msg.cipherText}</span>
                        </div>
                      ) : (
                        <div className="text-sm">
                          {msg.type === "text" && (
                            <p className="break-words leading-relaxed whitespace-pre-wrap">
                              {msg.content}
                            </p>
                          )}
                          {msg.type === "image" && (
                            <img
                              src={msg.fileUrl}
                              alt="P2P"
                              className="max-w-full rounded-md max-h-48 object-cover mt-1 border border-gray-700"
                            />
                          )}
                        </div>
                      )}
                      <div
                        className={`text-[9px] flex items-center gap-1 mt-1 ${
                          isMe
                            ? "text-emerald-300/60 justify-end"
                            : "text-gray-500 justify-start"
                        }`}
                      >
                        {msg.expiresAt && !msg.isDecrypting && (
                          <span className="flex items-center text-orange-400 bg-orange-500/10 px-1 rounded-sm">
                            <Clock className="w-2 h-2 mr-0.5" />
                            {Math.max(
                              1,
                              Math.round((msg.expiresAt - Date.now()) / 1000)
                            )}
                            s
                          </span>
                        )}
                        <span>
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Message */}
        <div className="p-3 bg-gray-900 border-t border-gray-800">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage("text");
            }}
            className="flex items-end gap-2 bg-gray-950 p-1.5 rounded-xl border border-gray-800"
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              disabled={connectionStatus !== "connected"}
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-white disabled:text-gray-700"
            >
              <Paperclip className="w-4.5 h-4.5" />
            </button>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={connectionStatus !== "connected"}
              placeholder={
                connectionStatus === "connected"
                  ? "Nhập tin nhắn..."
                  : "Chưa có kết nối..."
              }
              className="flex-1 bg-transparent max-h-24 text-sm text-gray-100 resize-none py-1.5 focus:outline-none"
              rows="1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage("text");
                }
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim() || connectionStatus !== "connected"}
              className={`p-2 rounded-full ${
                inputText.trim() && connectionStatus === "connected"
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-800 text-gray-600"
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
