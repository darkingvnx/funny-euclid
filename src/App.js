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
  Clock,
  UserPlus,
  Copy,
  Check,
  Phone,
  PhoneOff,
  Video,
  UserX,
  Activity,
  Terminal,
  EyeOff,
  Eye,
} from "lucide-react";

// ==========================================
// THUẬT TOÁN MÃ HÓA QUÂN ĐỘI (AES-GCM 256-bit)
// ==========================================
const cryptoSetup = {
  generateKey: async () => {
    return await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  },
  exportKey: async (key) => {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return Array.from(new Uint8Array(exported));
  },
  importKey: async (keyArray) => {
    return await window.crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyArray),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  },
  encryptData: async (key, payloadObj) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payloadObj));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded
    );
    return {
      cipherBytes: Array.from(new Uint8Array(ciphertext)),
      ivBytes: Array.from(iv),
    };
  },
  decryptData: async (key, cipherBytes, ivBytes) => {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(ivBytes) },
      key,
      new Uint8Array(cipherBytes)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  },
  bytesToHex: (bytes) =>
    bytes
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .substring(0, 32) + "...",
};

const generateNickname = () => {
  const adjs = ["Phantom", "Stealth", "Apex", "Cyber", "Nova"];
  const nouns = ["Protocol", "Unit", "Cipher", "Matrix", "Node"];
  return `${adjs[Math.floor(Math.random() * adjs.length)]}_${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;
};

export default function SecureChatApp() {
  const [currentUser, setCurrentUser] = useState({
    id: "",
    name: generateNickname(),
  });
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [encryptionState, setEncryptionState] = useState("unsecured");

  // State Media & P2P
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callState, setCallState] = useState("idle");
  const [isVideoCall, setIsVideoCall] = useState(false);

  // State UI & Chat
  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [timerSetting, setTimerSetting] = useState(0);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Tính năng mới
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const sharedKeyRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current && localStream)
      localVideoRef.current.srcObject = localStream;
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream)
      remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, callState]);

  // Phím tắt Kích hoạt Privacy Mode (Nút ESC)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setPrivacyMode((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // KHỞI TẠO PEERJS
  useEffect(() => {
    const peer = new Peer(undefined, {
      secure: true,
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.relay.metered.ca:80" },
          {
            urls: "turn:global.relay.metered.ca:80",
            username: "007f172b13f568869488991e",
            credential: "Ia/VNUXBdCJNlagv",
          },
        ],
      },
    });

    peer.on("open", (id) => setCurrentUser((prev) => ({ ...prev, id })));

    peer.on("connection", (conn) => {
      setConnectionStatus("connected");
      connRef.current = conn;
      setupConnectionListeners(conn);
    });

    peer.on("call", (incomingCall) => {
      setIsVideoCall(incomingCall.options?.metadata?.video || false);
      setActiveCall(incomingCall);
      setCallState("receiving");
    });

    peerRef.current = peer;
    return () => peer.destroy();
  }, []);

  const setupConnectionListeners = (conn) => {
    conn.on("data", async (data) => {
      // Nhận tín hiệu Typing
      if (data.type === "TYPING") setPartnerTyping(true);
      if (data.type === "STOP_TYPING") setPartnerTyping(false);

      if (data.type === "KEY_EXCHANGE") {
        setEncryptionState("handshaking");
        try {
          sharedKeyRef.current = await cryptoSetup.importKey(data.keyData);
          setEncryptionState("secured");
          conn.send({ type: "KEY_ACK" });
        } catch (err) {
          console.error("Lỗi khóa", err);
        }
      }

      if (data.type === "KEY_ACK") setEncryptionState("secured");

      if (data.type === "E2EE_MSG") {
        if (!sharedKeyRef.current) return;
        setPartnerTyping(false); // Dừng hiệu ứng typing khi có tin nhắn tới

        const realHexCipher = cryptoSetup.bytesToHex(data.cipherBytes);
        const tempMsgId = Math.random().toString();

        setMessages((prev) => [
          ...prev,
          {
            id: tempMsgId,
            isDecrypting: true,
            senderName: "Đối tác",
            cipherText: realHexCipher,
            timestamp: Date.now(),
          },
        ]);

        setTimeout(async () => {
          try {
            const decryptedPayload = await cryptoSetup.decryptData(
              sharedKeyRef.current,
              data.cipherBytes,
              data.ivBytes
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempMsgId
                  ? { ...decryptedPayload, isDecrypting: false }
                  : m
              )
            );
          } catch (e) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempMsgId
                  ? {
                      ...m,
                      content: "⚠️ Giải mã thất bại",
                      isDecrypting: false,
                    }
                  : m
              )
            );
          }
        }, 1200);
      }

      if (data.type === "CLEANUP_ROOM") {
        alert("Đối tác đã kích hoạt tự hủy phòng chat.");
        handleResetToLobby();
      }
    });

    conn.on("close", () => handleResetToLobby());
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!joinCode.trim() || !peerRef.current) return;
    setConnectionStatus("connecting");

    const conn = peerRef.current.connect(joinCode.trim(), {
      metadata: { name: currentUser.name },
    });
    connRef.current = conn;

    conn.on("open", async () => {
      setConnectionStatus("connected");
      setupConnectionListeners(conn);
      setEncryptionState("handshaking");
      const key = await cryptoSetup.generateKey();
      sharedKeyRef.current = key;
      const exportedRawKey = await cryptoSetup.exportKey(key);
      conn.send({ type: "KEY_EXCHANGE", keyData: exportedRawKey });
    });

    conn.on("error", () => {
      alert("Kết nối thất bại. Lỗi tường lửa hoặc sai mã.");
      handleResetToLobby();
    });

    setJoinCode("");
    setIsSidebarOpen(false);
  };

  // Hàm xử lý khi gõ phím (Typing Indicator)
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (connRef.current && connectionStatus === "connected") {
      connRef.current.send({ type: "TYPING" });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        connRef.current.send({ type: "STOP_TYPING" });
      }, 1500);
    }
  };

  const handleSendMessage = async (
    type = "text",
    content = inputText,
    fileDataUrl = null
  ) => {
    if (
      !sharedKeyRef.current ||
      (type === "text" && !content.trim() && !fileDataUrl)
    )
      return;
    clearTimeout(typingTimeoutRef.current);
    if (connRef.current) connRef.current.send({ type: "STOP_TYPING" });

    const deleteAt =
      timerSetting > 0 ? Date.now() + timerSetting * 1000 + 1200 : null;
    const msgId = Date.now().toString();

    const payloadObj = {
      id: msgId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      type: type,
      content: content,
      fileUrl: fileDataUrl,
      timestamp: Date.now(),
      deleteAt: deleteAt,
    };

    const { cipherBytes, ivBytes } = await cryptoSetup.encryptData(
      sharedKeyRef.current,
      payloadObj
    );
    const realHexCipher = cryptoSetup.bytesToHex(cipherBytes);

    connRef.current.send({ type: "E2EE_MSG", cipherBytes, ivBytes });

    setMessages((prev) => [
      ...prev,
      {
        ...payloadObj,
        isDecrypting: true,
        cipherText: realHexCipher,
      },
    ]);

    if (type === "text") setInputText("");

    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, isDecrypting: false } : m))
      );
    }, 1200);
  };

  // Cuộc gọi & Hủy kết nối
  const handleStartCall = async (videoEnabled) => {
    if (!connRef.current || connectionStatus !== "connected") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled ? { facingMode: "user" } : false,
        audio: true,
      });
      setLocalStream(stream);
      setIsVideoCall(videoEnabled);
      setCallState("calling");
      const call = peerRef.current.call(connRef.current.peer, stream, {
        metadata: { video: videoEnabled },
      });
      setActiveCall(call);
      call.on("stream", (remote) => {
        setCallState("active");
        setRemoteStream(remote);
      });
      call.on("close", () => handleEndCallLocal());
    } catch (err) {
      alert("Không thể truy cập Camera/Micro.");
    }
  };

  const handleAnswerCall = async () => {
    if (!activeCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoCall ? { facingMode: "user" } : false,
        audio: true,
      });
      setLocalStream(stream);
      activeCall.answer(stream);
      setCallState("active");
      activeCall.on("stream", (remote) => setRemoteStream(remote));
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024)
      return alert("WebRTC giới hạn file < 3MB.");
    const reader = new FileReader();
    reader.onload = () => handleSendMessage("image", file.name, reader.result);
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const handleDestroyRoom = () => {
    if (
      window.confirm("Hủy phòng chat và xóa sạch dữ liệu trên cả 2 thiết bị?")
    ) {
      if (connRef.current) {
        connRef.current.send({ type: "CLEANUP_ROOM" });
        setTimeout(() => connRef.current.close(), 500);
      }
      handleResetToLobby();
    }
  };

  const handleResetToLobby = () => {
    handleEndCallLocal();
    connRef.current = null;
    sharedKeyRef.current = null;
    setConnectionStatus("disconnected");
    setEncryptionState("unsecured");
    setMessages([]);
    setPartnerTyping(false);
  };

  // Garbage Collector
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages((prev) =>
        prev.filter((m) => !m.deleteAt || now < m.deleteAt)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fix lỗi Scroll tự động cuộn trang
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, partnerTyping]);

  // ==========================================
  // GIAO DIỆN UI/UX HIỆN ĐẠI
  // ==========================================
  return (
    <div className="flex h-screen w-screen bg-[#070b14] text-gray-100 font-sans overflow-hidden selection:bg-emerald-500/30">
      {/* Background Cyberpunk Blur */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* CHẾ ĐỘ ẨN DANH KHẨN CẤP (PRIVACY MODE) */}
      {privacyMode && (
        <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center">
          <Shield className="w-16 h-16 text-gray-600 mb-4" />
          <h2 className="text-xl font-bold text-gray-500 tracking-widest">
            CHẾ ĐỘ ẨN DANH
          </h2>
          <p className="text-sm text-gray-600 mt-2">
            Nhấn ESC hoặc chạm vào đây để mở khóa
          </p>
          <button
            onClick={() => setPrivacyMode(false)}
            className="absolute inset-0 w-full h-full cursor-default"
          ></button>
        </div>
      )}

      {/* SIDEBAR */}
      <div
        className={`${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 absolute md:relative z-30 flex flex-col w-72 md:w-80 h-full bg-[#0d1424]/90 backdrop-blur-2xl border-r border-white/5 transition-transform duration-300 ease-out shadow-2xl shrink-0`}
      >
        <div className="p-5 border-b border-white/5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <span className="block font-bold tracking-widest text-sm text-gray-100 uppercase">
                Aegis Core
              </span>
              <span className="block text-[10px] text-emerald-500 font-mono tracking-wider">
                AES-256 SECURE
              </span>
            </div>
          </div>
          <button
            className="md:hidden p-2 text-gray-400 hover:text-white bg-white/5 rounded-lg"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 mx-4 mt-5 bg-[#070b14]/80 border border-white/5 rounded-2xl shadow-inner relative group">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Mã Định Danh (ID)
          </div>
          <div className="flex items-center justify-between bg-black/40 rounded-xl p-3 border border-white/5">
            <span className="font-mono text-xs text-emerald-400 select-all truncate mr-2">
              {currentUser.id ? currentUser.id : "Đang khởi tạo..."}
            </span>
            {currentUser.id && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentUser.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-gray-400 hover:text-emerald-400 bg-white/5 p-2 rounded-lg transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-white/5 mt-auto bg-[#0d1424]">
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-3">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
              Ghép nối bảo mật
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nhập ID đối tác..."
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full bg-[#070b14] border border-white/10 rounded-xl p-3 text-xs text-gray-200 focus:outline-none focus:border-emerald-500/50 font-mono transition-all"
              />
              <button
                type="submit"
                disabled={connectionStatus === "connecting"}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 p-3 rounded-xl text-white shadow-[0_0_15px_rgba(5,150,105,0.4)] disabled:shadow-none transition-all flex items-center justify-center shrink-0"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {isSidebarOpen && (
        <div
          className="absolute inset-0 bg-black/80 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* VÙNG CHAT CHÍNH (Đã fix lỗi Flexbox) */}
      <div className="flex-1 flex flex-col h-screen w-full relative z-10 bg-transparent overflow-hidden">
        {/* Overlay Cuộc gọi */}
        {callState === "receiving" && (
          <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-xl">
            <div className="w-24 h-24 bg-emerald-500/20 border-2 border-emerald-400/50 rounded-full flex items-center justify-center text-emerald-400 shadow-[0_0_40px_rgba(5,150,105,0.4)] animate-pulse mb-6">
              {isVideoCall ? (
                <Video className="w-10 h-10" />
              ) : (
                <Phone className="w-10 h-10" />
              )}
            </div>
            <h3 className="text-xl font-bold text-white tracking-wide">
              Yêu cầu kết nối mã hóa
            </h3>
            <div className="flex gap-4 mt-8">
              <button
                onClick={handleAnswerCall}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-2xl font-semibold flex items-center gap-2 shadow-lg"
              >
                <Phone className="w-5 h-5" /> Chấp nhận
              </button>
              <button
                onClick={handleEndCallLocal}
                className="bg-red-600/90 hover:bg-red-500 text-white px-6 py-3 rounded-2xl font-semibold flex items-center gap-2 shadow-lg"
              >
                <PhoneOff className="w-5 h-5" /> Từ chối
              </button>
            </div>
          </div>
        )}

        {/* HEADER CHAT */}
        <div className="h-16 border-b border-white/5 flex justify-between items-center px-4 md:px-6 bg-[#0d1424]/80 backdrop-blur-xl shrink-0 z-20 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white bg-white/5 rounded-lg"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="relative">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                    connectionStatus === "connected"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-gray-800/50 border-gray-700 text-gray-500"
                  }`}
                >
                  <Activity
                    className={`w-4 h-4 ${
                      connectionStatus === "connected" ? "animate-pulse" : ""
                    }`}
                  />
                </div>
              </div>
              <div>
                <div className="font-bold text-sm tracking-wide text-gray-100 flex items-center gap-2">
                  {connectionStatus === "connected"
                    ? "Kênh P2P Đã Mở"
                    : "Chưa kết nối"}
                  {encryptionState === "secured" && (
                    <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                </div>
                <div className="text-[10px] font-mono text-gray-500">
                  {encryptionState === "secured" ? (
                    <span className="text-emerald-500">
                      AES-GCM Đang bảo vệ
                    </span>
                  ) : (
                    "Chờ thiết lập..."
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-3">
            {/* Nút Privacy Mode */}
            <button
              onClick={() => setPrivacyMode(true)}
              className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-transparent"
              title="Chế độ ẩn danh (ESC)"
            >
              <EyeOff className="w-4 h-4" />
            </button>

            {connectionStatus === "connected" && (
              <>
                <button
                  onClick={() => handleStartCall(false)}
                  disabled={callState !== "idle"}
                  className="p-2.5 text-emerald-400/80 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-xl transition-all border border-transparent disabled:opacity-50"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleStartCall(true)}
                  disabled={callState !== "idle"}
                  className="p-2.5 text-emerald-400/80 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-xl transition-all border border-transparent disabled:opacity-50"
                >
                  <Video className="w-4 h-4" />
                </button>
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button
                  onClick={handleDestroyRoom}
                  className="p-2.5 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all border border-transparent"
                  title="Phá hủy kết nối & Dữ liệu"
                >
                  <UserX className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* KHUNG VIDEO CALL */}
        {["calling", "active"].includes(callState) && (
          <div className="bg-[#050B14] border-b border-white/5 p-4 relative flex justify-center items-center shrink-0 z-10 shadow-inner">
            <div className="relative w-full max-w-2xl h-56 md:h-72 bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center group">
              {isVideoCall ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-900/30 border border-emerald-500/30 flex items-center justify-center animate-pulse">
                    <Activity className="w-8 h-8 text-emerald-400" />
                  </div>
                </div>
              )}
              {isVideoCall && localStream && (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-4 right-4 w-24 h-36 object-cover rounded-2xl border-2 border-black shadow-xl z-10"
                />
              )}
              <button
                onClick={handleEndCallLocal}
                className="absolute bottom-6 bg-red-600/90 hover:bg-red-500 text-white p-4 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.5)] z-20 transition-transform transform hover:scale-110"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* DANH SÁCH TIN NHẮN (Đã fix lỗi Flex) */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-hide relative z-0">
          {connectionStatus !== "connected" ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto opacity-70">
              <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-500 backdrop-blur-md mb-6 shadow-inner">
                <Shield className="w-10 h-10" />
              </div>
              <h3 className="font-bold text-lg text-gray-200 tracking-wide mb-2">
                Trạm Kênh Mật
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Hãy cung cấp ID để khởi tạo giao thức mã hóa AES-256 bảo vệ dữ
                liệu truyền tải của bạn.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isMe ? "items-end" : "items-start"
                    } w-full`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-3xl px-5 py-3 relative shadow-xl backdrop-blur-md border ${
                        isMe
                          ? "bg-emerald-600/20 text-emerald-50 border-emerald-500/20 rounded-br-none"
                          : "bg-white/5 text-gray-100 border-white/10 rounded-bl-none"
                      }`}
                    >
                      {msg.isDecrypting ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-emerald-400 uppercase">
                            <Lock className="w-3 h-3 animate-pulse" /> Đang giải
                            mã...
                          </div>
                          <span className="break-all font-mono text-xs opacity-50 text-gray-400 bg-black/40 p-2 rounded-lg">
                            {msg.cipherText}
                          </span>
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
                              alt="Secure Media"
                              className="max-w-full rounded-2xl max-h-60 object-cover mt-2 border border-white/10"
                            />
                          )}
                        </div>
                      )}

                      <div
                        className={`text-[10px] flex items-center gap-2 mt-2.5 font-mono opacity-70 ${
                          isMe
                            ? "justify-end text-emerald-300"
                            : "justify-start text-gray-400"
                        }`}
                      >
                        {msg.deleteAt && !msg.isDecrypting && (
                          <span className="flex items-center bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-md">
                            <Clock className="w-3 h-3 mr-1" />
                            {Math.max(
                              1,
                              Math.round((msg.deleteAt - Date.now()) / 1000)
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

              {/* Hiệu ứng gõ phím */}
              {partnerTyping && (
                <div className="flex flex-col items-start w-full">
                  <div className="bg-white/5 border border-white/10 rounded-3xl rounded-bl-none px-5 py-3 shadow-lg flex items-center gap-2">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></span>
                  </div>
                </div>
              )}
            </>
          )}
          {/* Element rỗng để cuộn tới */}
          <div ref={messagesEndRef} className="h-1" />
        </div>

        {/* INPUT AREA */}
        <div className="p-4 md:p-6 bg-[#0d1424]/90 backdrop-blur-2xl border-t border-white/5 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] shrink-0 z-20">
          <div className="flex gap-2 mb-3 relative">
            <button
              type="button"
              onClick={() => setShowTimerMenu(!showTimerMenu)}
              disabled={connectionStatus !== "connected"}
              className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl border font-mono tracking-wide transition-all ${
                timerSetting > 0
                  ? "bg-orange-500/10 text-orange-400 border-orange-500/30"
                  : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <Clock className="w-4 h-4" />
              {timerSetting === 0 ? "Hẹn Giờ: OFF" : `Hủy sau ${timerSetting}s`}
            </button>

            {showTimerMenu && (
              <div className="absolute bottom-full left-0 mb-3 w-40 bg-[#070b14] border border-white/10 rounded-2xl shadow-2xl z-30 overflow-hidden backdrop-blur-xl font-mono text-sm">
                <div className="px-4 py-3 border-b border-white/5 text-gray-500 uppercase tracking-widest text-[10px]">
                  Thời gian tự hủy
                </div>
                {[0, 5, 10, 30].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setTimerSetting(val);
                      setShowTimerMenu(false);
                    }}
                    className="block w-full text-left px-4 py-3 text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                  >
                    {val === 0 ? "Tắt" : `${val} Giây`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage("text");
            }}
            className="flex items-end gap-2 bg-[#050B14] p-2 rounded-3xl border border-white/10 focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all"
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
              className="p-3 text-gray-400 hover:text-emerald-400 bg-white/5 hover:bg-emerald-500/10 rounded-2xl transition-all disabled:opacity-30"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <textarea
              value={inputText}
              onChange={handleInputChange}
              disabled={connectionStatus !== "connected"}
              placeholder={
                connectionStatus === "connected"
                  ? "Nhập tin nhắn mã hóa..."
                  : "Khóa P2P chưa sẵn sàng..."
              }
              className="flex-1 bg-transparent max-h-32 min-h-[48px] text-sm text-gray-100 placeholder-gray-600 resize-none py-3.5 px-3 focus:outline-none scrollbar-hide"
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
              className={`p-3 rounded-2xl transition-all flex items-center justify-center shrink-0 ${
                inputText.trim() && connectionStatus === "connected"
                  ? "bg-emerald-600 text-white shadow-lg transform hover:scale-105"
                  : "bg-white/5 text-gray-600"
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
