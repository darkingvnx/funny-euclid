import React, { useState, useEffect, useRef, useCallback } from "react";
import Peer from "peerjs";
import {
  Shield,
  Lock,
  Menu,
  X,
  Send,
  Paperclip,
  Clock,
  Monitor,
  UserPlus,
  Copy,
  Check,
  Phone,
  PhoneOff,
  Video,
  UserX,
  Activity,
  Terminal,
  Eye,
  FileCode,
  Zap,
} from "lucide-react";

// ==========================================
// CẤU HÌNH TURN/STUN
// ==========================================
// ⚠️ LƯU Ý BẢO MẬT: Không nên hardcode username/credential của TURN server
// trực tiếp trong mã nguồn frontend khi triển khai production, vì bất kỳ ai
// mở DevTools cũng đọc được. Cách làm đúng: dựng một endpoint backend nhỏ
// (hoặc dùng Twilio NTS / Cloudflare Calls / Metered API) để cấp token TURN
// ngắn hạn (short-lived credential) cho từng phiên. Ở đây mình tách ra thành
// một hằng số riêng để dễ thay bằng biến môi trường / fetch từ backend.
// Lưu ý: sandbox này chạy trên Create React App (react-scripts/Webpack), không phải Vite,
// nên KHÔNG dùng được import.meta.env (đó là cú pháp riêng của Vite) — dùng process.env
// chuẩn CRA thay thế. Muốn cấu hình qua biến môi trường, tạo file .env với:
//   REACT_APP_TURN_USERNAME=...
//   REACT_APP_TURN_CREDENTIAL=...
const TURN_USERNAME =
  process.env.REACT_APP_TURN_USERNAME || "007f172b13f568869488991e";
const TURN_CREDENTIAL =
  process.env.REACT_APP_TURN_CREDENTIAL || "Ia/VNUXBdCJNlagv";

const ICE_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  // TURN qua UDP (nhanh nhất khi mạng cho phép)
  {
    urls: "turn:global.relay.metered.ca:80",
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
  // Dự phòng khi UDP bị chặn: ép qua TCP cổng 80
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
  // Dự phòng khi cổng 80 cũng bị chặn: thử cổng 443 (thường mở cho HTTPS)
  {
    urls: "turn:global.relay.metered.ca:443",
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
  // Phương án cuối cùng cho mạng doanh nghiệp/firewall khó nhất: TURN qua TLS trên cổng 443,
  // trông giống hệt traffic HTTPS bình thường nên gần như luôn lọt qua được
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — chặn ảnh quá lớn trước khi convert canvas

// ==========================================
// 1. LÕI BẢO MẬT AES-GCM 256-BIT
// ==========================================
const cryptoSetup = {
  generateKey: async () =>
    await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    ),
  exportKey: async (key) =>
    Array.from(
      new Uint8Array(await window.crypto.subtle.exportKey("raw", key))
    ),
  importKey: async (keyArray) =>
    await window.crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyArray),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    ),
  encryptData: async (key, payloadObj) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payloadObj));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    return { cipherBuffer: ciphertext, ivBuffer: iv };
  },
  decryptData: async (key, cipherBuffer, ivBuffer) => {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuffer },
      key,
      cipherBuffer
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  },
  bytesToHex: (buffer) =>
    Array.from(new Uint8Array(buffer).slice(0, 10))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("") + "...",
};

// ==========================================
// 2. THUẬT TOÁN MẬT THƯ TRONG ẢNH (LSB STEGANOGRAPHY)
// ==========================================
// Ghi chú: nội dung mật thư này vẫn nằm trong payloadObj được mã hoá AES-GCM
// trước khi gửi đi (xem handleSendMessage), nên không cần mã hoá riêng ở đây —
// LSB chỉ đóng vai trò "giấu" trong ảnh, còn "khoá" vẫn là AES-GCM của kênh.
const stego = {
  encode: (imgDataUrl, secretText) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        const textBytes = new TextEncoder().encode(secretText + "||END||");
        const capacityBits = Math.floor((data.length * 3) / 4); // 3 trong 4 kênh (bỏ alpha)
        if (textBytes.length * 8 > capacityBits) {
          reject("Ảnh quá nhỏ để giấu hết nội dung mật thư này.");
          return;
        }

        let byteIdx = 0;
        let bitIdx = 0;
        for (let i = 0; i < data.length; i++) {
          if ((i + 1) % 4 === 0) continue;
          if (byteIdx < textBytes.length) {
            const bit = (textBytes[byteIdx] >> (7 - bitIdx)) & 1;
            data[i] = (data[i] & 254) | bit;
            bitIdx++;
            if (bitIdx === 8) {
              bitIdx = 0;
              byteIdx++;
            }
          } else break;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject("Không đọc được ảnh để giấu mật thư.");
      img.src = imgDataUrl;
    });
  },
  decode: (imgDataUrl) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        let bytes = [];
        let currentByte = 0;
        let bitIdx = 0;
        for (let i = 0; i < data.length; i++) {
          if ((i + 1) % 4 === 0) continue;
          currentByte = (currentByte << 1) | (data[i] & 1);
          bitIdx++;
          if (bitIdx === 8) {
            bytes.push(currentByte);
            currentByte = 0;
            bitIdx = 0;
            if (bytes.length >= 7) {
              const endStr = String.fromCharCode(...bytes.slice(-7));
              if (endStr === "||END||") {
                resolve(
                  new TextDecoder().decode(new Uint8Array(bytes.slice(0, -7)))
                );
                return;
              }
            }
          }
        }
        reject("Không tìm thấy lớp mật thư.");
      };
      img.onerror = () => reject("Không đọc được ảnh.");
      img.src = imgDataUrl;
    });
  },
};

const generateNickname = () => `Agent_${Math.floor(100 + Math.random() * 900)}`;

export default function SecureChatApp() {
  const [currentUser, setCurrentUser] = useState({
    id: "",
    name: generateNickname(),
  });
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [encryptionState, setEncryptionState] = useState("unsecured");

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callState, setCallState] = useState("idle");
  const [isVideoCall, setIsVideoCall] = useState(false);

  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [inputText, setInputText] = useState("");
  const [previewImage, setPreviewImage] = useState(null);

  const [joinCode, setJoinCode] = useState("");
  const [timerSetting, setTimerSetting] = useState(0);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const [partnerTyping, setPartnerTyping] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [revealedMsgId, setRevealedMsgId] = useState(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const [isStegoMode, setIsStegoMode] = useState(false);
  const [secretText, setSecretText] = useState("");
  const [stegoError, setStegoError] = useState("");

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const sharedKeyRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isUploadingRef = useRef(false);
  const lastTypingTimeRef = useRef(0); // FIX: thiếu khai báo trong bản gốc → gây crash khi gõ chữ
  const privacyModeRef = useRef(false); // dùng trong listener toàn cục để tránh đăng ký lại liên tục

  useEffect(() => {
    privacyModeRef.current = privacyMode;
  }, [privacyMode]);

  useEffect(() => {
    if (localVideoRef.current && localStream)
      localVideoRef.current.srcObject = localStream;
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream)
      remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, callState]);

  // ==========================================
  // HỆ THỐNG BOSS KEY & "BẢO VỆ MÀN HÌNH"
  // ==========================================
  // ⚠️ Thành thật với người dùng: chặn phím PrintScreen, chặn Ctrl+C hay
  // preventDefault trên contextmenu chỉ là rào cản UX ở tầng trình duyệt —
  // KHÔNG thể ngăn chụp màn hình thật sự (OS-level screenshot, điện thoại
  // chụp màn hình laptop, ứng dụng chụp màn hình của hệ điều hành...) và
  // dễ dàng bị vượt qua bằng DevTools. Không nên quảng cáo tính năng này
  // như một cơ chế bảo mật thật sự — nó chỉ là lớp "khó chịu nhẹ" (deterrent).
  useEffect(() => {
    const handleCopy = (e) => {
      if (!privacyModeRef.current) e.preventDefault();
    };
    const handleBlur = () => {
      if (!isUploadingRef.current) setPrivacyMode(true);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) handleBlur();
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "PrintScreen") {
        setPrivacyMode(true);
        if (connRef.current) connRef.current.send({ type: "SCREENSHOT_ALERT" });
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPrivacyMode(false);
      }
      if (
        !privacyModeRef.current &&
        (e.keyCode === 123 ||
          (e.ctrlKey && e.shiftKey && e.keyCode === 73) ||
          (e.ctrlKey && e.key === "c"))
      ) {
        e.preventDefault();
      }
    };
    const handleContextMenu = (e) => {
      if (!privacyModeRef.current) e.preventDefault();
    };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("copy", handleCopy);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);

    // FIX: bản gốc dùng callback ẩn danh cho "visibilitychange" nên
    // removeEventListener không bao giờ gỡ được đúng listener → rò rỉ
    // listener mỗi lần effect chạy lại. Giờ đặt tên hàm và gỡ đúng chỗ,
    // đồng thời effect này chỉ chạy 1 lần (dependency rỗng) nhờ privacyModeRef.
    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
    setIsScrolledUp(scrollHeight - scrollTop - clientHeight >= 50);
  };

  useEffect(() => {
    const peer = new Peer(undefined, {
      secure: true,
      config: { iceServers: ICE_SERVERS },
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
    peer.on("error", (err) => {
      console.error("Peer error:", err);
    });

    peerRef.current = peer;
    return () => peer.destroy();
  }, []);

  const setupConnectionListeners = (conn) => {
    conn.on("data", async (data) => {
      if (data.type === "TYPING") setPartnerTyping(true);
      if (data.type === "STOP_TYPING") setPartnerTyping(false);

      if (data.type === "SCREENSHOT_ALERT") {
        alert(
          "🛡️ CẢNH BÁO: Đối tác đã chuyển tab hoặc có dấu hiệu chụp màn hình!"
        );
      }

      if (data.type === "KEY_EXCHANGE") {
        setEncryptionState("handshaking");
        try {
          sharedKeyRef.current = await cryptoSetup.importKey(data.keyData);
          setEncryptionState("secured");
          conn.send({ type: "KEY_ACK" });
        } catch (err) {
          console.error("Lỗi trao đổi khoá:", err);
        }
      }
      if (data.type === "KEY_ACK") setEncryptionState("secured");

      if (data.type === "E2EE_MSG") {
        if (!sharedKeyRef.current) return;
        setPartnerTyping(false);

        const realHexCipher = cryptoSetup.bytesToHex(data.cipherBuffer);
        const tempMsgId = crypto.randomUUID();

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

        try {
          const decryptedPayload = await cryptoSetup.decryptData(
            sharedKeyRef.current,
            data.cipherBuffer,
            data.ivBuffer
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempMsgId
                ? { ...decryptedPayload, id: tempMsgId, isDecrypting: false }
                : m
            )
          );
        } catch (e) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempMsgId
                ? {
                    ...m,
                    content: "⚠️ Dữ liệu hỏng hoặc sai khoá",
                    isDecrypting: false,
                  }
                : m
            )
          );
        }
      }

      if (data.type === "CLEANUP_ROOM") {
        handleResetToLobby();
        alert("Phòng chat đã bị hủy. Bộ nhớ RAM đã được làm sạch.");
      }
    });
    conn.on("close", () => handleResetToLobby());
    conn.on("error", (err) => console.error("Connection error:", err));
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!joinCode.trim() || !peerRef.current) return;
    if (joinCode.trim() === currentUser.id) {
      alert("Bạn không thể tự kết nối với chính mình.");
      return;
    }
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
      alert("ID không tồn tại hoặc lỗi mạng.");
      handleResetToLobby();
    });
    setJoinCode("");
    setIsSidebarOpen(false);
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (connRef.current && connectionStatus === "connected") {
      const now = Date.now();
      if (now - lastTypingTimeRef.current > 1000) {
        connRef.current.send({ type: "TYPING" });
        lastTypingTimeRef.current = now;
      }
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        connRef.current?.send({ type: "STOP_TYPING" });
      }, 2000);
    }
  };

  // ==========================================
  // GỬI TIN NHẮN (văn bản + ảnh gộp, có thể kèm mật thư)
  // ==========================================
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!sharedKeyRef.current || !connRef.current) return;
    if (!inputText.trim() && !previewImage) return;

    connRef.current.send({ type: "STOP_TYPING" });

    let finalImageUrl = previewImage;
    let hasStego = false;

    if (isStegoMode && secretText.trim()) {
      if (!previewImage) {
        setStegoError(
          "Chế độ Mật Thư yêu cầu bạn phải chọn một bức ảnh để làm vỏ bọc!"
        );
        return;
      }
      try {
        finalImageUrl = await stego.encode(previewImage, secretText);
        hasStego = true;
      } catch (err) {
        setStegoError(
          typeof err === "string" ? err : "Không thể giấu mật thư vào ảnh này."
        );
        return;
      }
    }

    const deleteAt =
      timerSetting > 0 ? Date.now() + timerSetting * 1000 + 500 : null;
    const msgId = crypto.randomUUID();

    const payloadObj = {
      id: msgId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      content: inputText.trim(),
      fileUrl: finalImageUrl,
      timestamp: Date.now(),
      deleteAt,
      hasStego,
    };

    try {
      const { cipherBuffer, ivBuffer } = await cryptoSetup.encryptData(
        sharedKeyRef.current,
        payloadObj
      );
      const realHexCipher = cryptoSetup.bytesToHex(cipherBuffer);

      connRef.current.send({ type: "E2EE_MSG", cipherBuffer, ivBuffer });

      setMessages((prev) => [
        ...prev,
        { ...payloadObj, isDecrypting: true, cipherText: realHexCipher },
      ]);

      setInputText("");
      setPreviewImage(null);
      setIsStegoMode(false);
      setSecretText("");
      setStegoError("");
      setIsScrolledUp(false);

      setTimeout(
        () =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, isDecrypting: false } : m
            )
          ),
        400
      );
    } catch (err) {
      console.error("Lỗi mã hoá tin nhắn:", err);
      alert("Gửi thất bại: không thể mã hoá tin nhắn.");
    }
  };

  const handleFileUpload = (e) => {
    isUploadingRef.current = false;
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Hệ thống chỉ hỗ trợ xử lý hình ảnh.");
      e.target.value = null;
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert("Ảnh quá lớn (tối đa 8MB). Vui lòng chọn ảnh khác.");
      e.target.value = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1200;
        let scaleSize = 1;
        if (img.width > MAX_WIDTH) scaleSize = MAX_WIDTH / img.width;

        canvas.width = img.width * scaleSize;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        setPreviewImage(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => alert("Không đọc được ảnh này.");
      img.src = event.target.result;
    };
    reader.onerror = () => alert("Không đọc được tệp này.");
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const decodeStego = async (fileUrl) => {
    try {
      const decodedText = await stego.decode(fileUrl);
      alert(`MẬT THƯ ĐƯỢC GIẤU TRONG ẢNH:\n\n"${decodedText}"`);
    } catch (e) {
      alert("Lỗi: " + e);
    }
  };

  const openFilePicker = () => {
    isUploadingRef.current = true;
    fileInputRef.current?.click();
    setTimeout(() => {
      isUploadingRef.current = false;
    }, 3000);
  };

  const handleStartCall = async (videoEnabled, isScreenShare = false) => {
    if (!connRef.current || connectionStatus !== "connected") return;
    try {
      let stream;
      if (isScreenShare) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" },
          audio: false,
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoEnabled ? { facingMode: "user" } : false,
          audio: true,
        });
      }

      setLocalStream(stream);
      setIsVideoCall(videoEnabled || isScreenShare);
      setCallState("calling");

      const call = peerRef.current.call(connRef.current.peer, stream, {
        metadata: { video: videoEnabled || isScreenShare },
      });
      setActiveCall(call);

      call.on("stream", (remote) => {
        setCallState("active");
        setRemoteStream(remote);
      });
      call.on("close", () => handleEndCallLocal());

      if (isScreenShare) {
        // FIX: bản gốc đọc biến state `activeCall` bên trong closure — tại thời
        // điểm này state chưa kịp cập nhật (setState bất đồng bộ) nên có thể
        // đóng nhầm cuộc gọi cũ/undefined. Dùng thẳng biến cục bộ `call`.
        stream.getVideoTracks()[0].onended = () => {
          handleEndCallLocal();
          call.close();
        };
      }
    } catch (err) {
      console.error("Không thể bắt đầu cuộc gọi:", err);
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

  const handleDestroyRoom = () => {
    if (
      window.confirm(
        "Kích hoạt giao thức tự hủy?\nDữ liệu trên 2 thiết bị sẽ bị xóa."
      )
    ) {
      if (connRef.current) {
        connRef.current.send({ type: "CLEANUP_ROOM" });
        setTimeout(() => connRef.current?.close(), 500);
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

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.deleteAt || now < m.deleteAt);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (messagesEndRef.current && !isScrolledUp) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, partnerTyping, isScrolledUp]);

  // ==========================================
  // GIAO DIỆN NGỤY TRANG (BOSS KEY)
  // ==========================================
  if (privacyMode) {
    return (
      <div className="flex flex-col h-screen w-screen bg-white text-black font-sans text-sm select-none">
        <div className="bg-[#107c41] text-white flex items-center px-4 py-2 gap-4">
          <div className="font-bold text-lg">Excel</div>
          <div className="text-xs flex gap-4">
            <span>File</span>
            <span>Home</span>
            <span>Insert</span>
            <span>Data</span>
            <span>Review</span>
          </div>
        </div>
        <div className="bg-gray-100 flex items-center p-2 border-b border-gray-300 gap-2">
          <div className="bg-white border px-2 py-1 font-mono text-xs shadow-sm">
            A1
          </div>
          <div className="font-mono text-gray-500 italic flex-1 border bg-white px-2 py-1 shadow-sm">
            fx
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex bg-gray-200 border-b border-gray-400 font-bold text-center">
            <div className="w-10 border-r border-gray-400 bg-gray-300"></div>
            {["A", "B", "C", "D", "E", "F", "G"].map((char) => (
              <div key={char} className="w-32 border-r border-gray-400 py-1">
                {char}
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-auto text-xs font-mono">
            {Array.from({ length: 30 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex border-b border-gray-300 hover:bg-blue-50"
              >
                <div className="w-10 border-r border-gray-400 bg-gray-200 flex items-center justify-center font-bold text-gray-600">
                  {rowIndex + 1}
                </div>
                {[
                  "Income",
                  "2450.00",
                  "1890.50",
                  "3200.00",
                  "Expense",
                  "-450.00",
                  "Tax",
                ].map((val, i) => (
                  <div
                    key={i}
                    className={`w-32 border-r border-gray-300 px-2 py-1 truncate ${
                      i > 0 && i !== 4 ? "text-right" : ""
                    }`}
                  >
                    {i > 0 && i !== 4
                      ? `$${(Math.random() * 5000).toFixed(2)}`
                      : val}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="fixed bottom-2 right-2 text-[8px] text-gray-400 opacity-50">
          Press Ctrl+Alt+K to unlock
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-[#09090b] text-zinc-200 font-sans overflow-hidden select-none antialiased">
      {connectionStatus === "connected" && (
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.02] flex flex-wrap justify-center items-center rotate-[-30deg]">
          {Array.from({ length: 40 }).map((_, i) => (
            <span
              key={i}
              className="text-3xl font-bold p-12 font-mono text-zinc-500"
            >
              {currentUser.id}
            </span>
          ))}
        </div>
      )}

      {/* SIDEBAR */}
      <div
        className={`${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 absolute md:relative z-30 flex flex-col w-72 md:w-80 h-full bg-[#131316] border-r border-zinc-800/50 transition-transform duration-500 shadow-2xl shrink-0`}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <Shield className="w-5 h-5 text-emerald-400" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-wide text-zinc-100">
                Aegis Core
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] text-zinc-500 font-medium tracking-wider uppercase">
                  End-to-End Encrypted
                </span>
              </div>
            </div>
          </div>
          <button
            className="md:hidden p-2 text-zinc-500 bg-zinc-800/50 rounded-full"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Đóng menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-2">
          <div className="bg-[#18181b] border border-zinc-800/80 rounded-2xl p-4 shadow-sm relative">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> Mã Định Danh
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-zinc-200 select-all tracking-wider">
                {currentUser.id || "Generating..."}
              </span>
              {currentUser.id && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(currentUser.id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-zinc-500 hover:text-emerald-400 bg-zinc-800/50 p-2 rounded-xl"
                  aria-label="Sao chép ID"
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
        </div>

        <div className="p-6 mt-auto">
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-3">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
              Ghép nối
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Dán ID đối tác..."
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full bg-[#18181b] border border-zinc-800 rounded-xl p-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 font-mono"
              />
              <button
                type="submit"
                disabled={connectionStatus === "connecting"}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-3 rounded-xl disabled:opacity-50"
                aria-label="Kết nối"
              >
                <UserPlus className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>
          </form>
        </div>
      </div>

      {isSidebarOpen && (
        <div
          className="absolute inset-0 bg-[#09090b]/80 backdrop-blur-sm z-20 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* VÙNG CHAT CHÍNH */}
      <div className="flex-1 flex flex-col h-screen w-full relative z-10 bg-[#09090b]">
        <div className="h-20 flex justify-between items-center px-6 bg-transparent shrink-0 z-20">
          <div className="flex items-center gap-4">
            <button
              className="md:hidden p-2 -ml-2 text-zinc-400 bg-zinc-900 rounded-full"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Mở menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center border ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-zinc-900 border-zinc-800 text-zinc-600"
                }`}
              >
                <Lock className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="font-medium text-base text-zinc-100 tracking-wide">
                  {connectionStatus === "connected"
                    ? "Kênh Mã Hóa P2P"
                    : "Trạm Chờ"}
                </h2>
                <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                  {encryptionState === "secured" ? (
                    <span className="text-emerald-500 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Đã khóa E2EE
                    </span>
                  ) : (
                    "Chờ..."
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 z-50">
            <button
              onClick={() => setPrivacyMode(true)}
              className="p-3 text-zinc-400 hover:text-zinc-100 bg-zinc-900 rounded-full transition-all"
              title="Kích hoạt ngụy trang (ESC)"
              aria-label="Kích hoạt chế độ ngụy trang"
            >
              <FileCode className="w-5 h-5" strokeWidth={1.5} />
            </button>

            {connectionStatus === "connected" && (
              <div className="flex items-center bg-[#18181b] rounded-full p-1.5 border border-zinc-800/80 shadow-lg ml-2 backdrop-blur-md">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleStartCall(false)}
                    disabled={callState !== "idle"}
                    className="p-2.5 text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800 rounded-full transition-all duration-200 disabled:opacity-40 active:scale-95"
                    aria-label="Gọi thoại"
                  >
                    <Phone className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleStartCall(true)}
                    disabled={callState !== "idle"}
                    className="p-2.5 text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800 rounded-full transition-all duration-200 disabled:opacity-40 active:scale-95"
                    aria-label="Gọi video"
                  >
                    <Video className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleStartCall(false, true)}
                    disabled={callState !== "idle"}
                    className="p-2.5 text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800 rounded-full transition-all duration-200 disabled:opacity-40 active:scale-95"
                    aria-label="Chia sẻ màn hình"
                  >
                    <Monitor className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="w-[1px] h-7 bg-zinc-700/60 mx-2.5"></div>
                <button
                  onClick={handleDestroyRoom}
                  className="p-2.5 text-red-400 hover:text-red-200 hover:bg-red-500/20 rounded-full transition-all duration-300 group active:scale-90"
                  aria-label="Hủy phòng"
                >
                  <UserX
                    className="w-5 h-5 group-hover:scale-110 transition-transform"
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            )}
          </div>
        </div>

        {callState === "receiving" && (
          <div className="p-4 mx-6 mt-2 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between shrink-0 z-20">
            <span className="text-sm text-emerald-300">
              Cuộc gọi {isVideoCall ? "video" : "thoại"} đến...
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleAnswerCall}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm"
              >
                Trả lời
              </button>
              <button
                onClick={handleEndCallLocal}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm"
              >
                Từ chối
              </button>
            </div>
          </div>
        )}

        {["calling", "active"].includes(callState) && (
          <div className="p-6 relative flex justify-center items-center shrink-0 z-10">
            <div
              className="relative w-full max-w-4xl h-72 md:h-96 bg-[#131316] rounded-[2rem] overflow-hidden border border-zinc-800/80 shadow-2xl flex items-center justify-center group"
              onContextMenu={(e) => e.preventDefault()}
            >
              {isVideoCall ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain relative z-10 pointer-events-none bg-black"
                />
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-24 h-24 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner">
                    <Activity
                      className="w-10 h-10 text-emerald-500 animate-pulse"
                      strokeWidth={1}
                    />
                  </div>
                </div>
              )}
              {isVideoCall && localStream && (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-5 right-5 w-32 h-48 object-cover rounded-2xl border-4 border-[#131316] shadow-2xl z-20 pointer-events-none"
                />
              )}
              <button
                onClick={handleEndCallLocal}
                className="absolute bottom-8 bg-red-500 hover:bg-red-600 text-white p-4 rounded-full shadow-[0_10px_20px_rgba(239,68,68,0.3)] z-40 transition-transform transform hover:scale-105"
                aria-label="Kết thúc cuộc gọi"
              >
                <PhoneOff className="w-6 h-6" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* DANH SÁCH TIN NHẮN */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-6 scrollbar-hide relative z-0"
        >
          {connectionStatus !== "connected" ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
              <div className="w-24 h-24 rounded-[2rem] bg-[#18181b] border border-zinc-800/80 flex items-center justify-center text-zinc-600 mb-8">
                <Shield className="w-10 h-10" strokeWidth={1} />
              </div>
              <h3 className="font-normal text-xl text-zinc-300 tracking-wide mb-3">
                Chờ Thiết Lập...
              </h3>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                const isRevealed = revealedMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isMe ? "items-end" : "items-start"
                    } w-full`}
                  >
                    <div
                      onPointerDown={() => setRevealedMsgId(msg.id)}
                      onPointerUp={() => setRevealedMsgId(null)}
                      onPointerLeave={() => setRevealedMsgId(null)}
                      className={`max-w-[85%] md:max-w-[65%] rounded-3xl px-6 py-4 relative cursor-pointer select-none overflow-hidden transition-all duration-300 group ${
                        isMe
                          ? "bg-[#101014] border border-zinc-800/60 rounded-br-md text-zinc-200"
                          : "bg-[#18181b] border border-zinc-800/60 rounded-bl-md text-zinc-200"
                      }`}
                    >
                      <div
                        className={`absolute inset-0 z-20 flex items-center justify-center flex-col bg-[#131316]/95 backdrop-blur-sm transition-opacity duration-200 ease-in-out ${
                          isRevealed || msg.isDecrypting
                            ? "opacity-0 pointer-events-none"
                            : "opacity-100"
                        }`}
                      >
                        <Eye
                          className="w-6 h-6 text-zinc-500 mb-2 group-hover:text-zinc-400"
                          strokeWidth={1.5}
                        />
                        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em]">
                          Chạm & Giữ
                        </span>
                      </div>

                      <div
                        className={`transition-opacity duration-300 ${
                          !isRevealed && !msg.isDecrypting
                            ? "opacity-0"
                            : "opacity-100"
                        }`}
                      >
                        {msg.isDecrypting ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 font-mono text-[10px] text-emerald-500/80 uppercase">
                              <Lock className="w-3.5 h-3.5 animate-pulse" />{" "}
                              AES-256
                            </div>
                            <span className="break-all font-mono text-xs text-zinc-600 bg-zinc-900 p-2.5 rounded-xl border border-zinc-800/50">
                              {msg.cipherText}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[15px] font-light leading-relaxed">
                            {msg.content && (
                              <p className="whitespace-pre-wrap">
                                {msg.content}
                              </p>
                            )}

                            {msg.fileUrl && (
                              <div className="relative mt-2 rounded-2xl overflow-hidden border border-zinc-800 shadow-inner">
                                <img
                                  src={msg.fileUrl}
                                  alt="Ảnh đính kèm đã mã hoá"
                                  draggable="false"
                                  className="max-w-full max-h-72 object-cover relative z-10 pointer-events-none"
                                />
                                {msg.hasStego && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      decodeStego(msg.fileUrl);
                                    }}
                                    className="absolute bottom-2 right-2 bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur-md z-30 flex items-center gap-1.5 shadow-lg"
                                  >
                                    <Zap className="w-3.5 h-3.5" /> Giải Mã Mật
                                    Thư
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div
                          className={`text-[10px] flex items-center gap-2 mt-3 font-mono ${
                            isMe
                              ? "justify-end text-zinc-500"
                              : "justify-start text-zinc-500"
                          }`}
                        >
                          {msg.deleteAt && !msg.isDecrypting && (
                            <span className="flex items-center bg-orange-500/10 text-orange-400/80 px-2 py-0.5 rounded-md">
                              <Clock className="w-3 h-3 mr-1" strokeWidth={2} />
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
                  </div>
                );
              })}

              {partnerTyping && (
                <div className="flex flex-col items-start w-full">
                  <div className="bg-[#18181b] border border-zinc-800/60 rounded-3xl rounded-bl-md px-6 py-4 flex items-center gap-1.5 h-[56px]">
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span>
                    <span
                      className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.15s" }}
                    ></span>
                    <span
                      className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.3s" }}
                    ></span>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* INPUT AREA */}
        <div className="p-4 md:px-8 md:pb-8 pt-2 shrink-0 z-20 relative bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent">
          <div className="max-w-4xl mx-auto relative">
            <div className="absolute -top-12 left-0 flex gap-2">
              <button
                type="button"
                onClick={() => setShowTimerMenu(!showTimerMenu)}
                disabled={connectionStatus !== "connected"}
                className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-full border font-mono transition-all backdrop-blur-md shadow-sm ${
                  timerSetting > 0
                    ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                    : "bg-[#18181b]/80 text-zinc-400 border-zinc-800/80 hover:bg-zinc-800"
                } disabled:opacity-0 disabled:pointer-events-none z-50`}
              >
                <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                {timerSetting === 0 ? "TTL: OFF" : `${timerSetting}s`}
              </button>
              {showTimerMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-36 bg-[#18181b] border border-zinc-800 rounded-2xl shadow-2xl z-[100] overflow-hidden font-mono text-sm py-1">
                  {[0, 5, 10, 30].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setTimerSetting(val);
                        setShowTimerMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 text-zinc-400 hover:bg-zinc-800 transition-colors"
                    >
                      {val === 0 ? "Tắt TTL" : `${val} Giây`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isStegoMode && (
              <div className="absolute bottom-[100px] left-0 w-full bg-[#18181b] border border-emerald-500/30 rounded-2xl p-3 mb-2 shadow-2xl z-40">
                <div className="flex items-center gap-2 mb-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                  <Zap className="w-4 h-4" /> Viết Mật Thư (yêu cầu phải đính
                  kèm ảnh bọc ngoài)
                </div>
                <textarea
                  value={secretText}
                  onChange={(e) => {
                    setSecretText(e.target.value);
                    setStegoError("");
                  }}
                  placeholder="Nội dung sẽ được chèn vô hình vào từng pixel của bức ảnh..."
                  className="w-full bg-[#09090b] text-zinc-200 border border-zinc-700/50 rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-500/50 min-h-[60px]"
                />
                {stegoError && (
                  <div className="text-red-400 text-xs mt-2">{stegoError}</div>
                )}
              </div>
            )}

            <form
              onSubmit={handleSendMessage}
              className="flex flex-col bg-[#131316] p-2 rounded-[2rem] border border-zinc-800/80 shadow-2xl transition-all focus-within:border-emerald-500/30 focus-within:ring-1 focus-within:ring-emerald-500/10 z-50 relative"
            >
              {previewImage && (
                <div className="relative self-start ml-4 mt-2 mb-2">
                  <img
                    src={previewImage}
                    alt="Xem trước"
                    className="h-24 object-cover rounded-xl border border-zinc-700/50 shadow-md"
                  />
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    className="absolute -top-2 -right-2 bg-zinc-800 hover:bg-red-500 text-zinc-300 hover:text-white p-1 rounded-full transition-colors shadow-lg"
                    aria-label="Xoá ảnh"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2 w-full">
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
                  onClick={() => setIsStegoMode(!isStegoMode)}
                  className={`p-3.5 rounded-full transition-all disabled:opacity-30 ${
                    isStegoMode
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50"
                  }`}
                  title="Chế độ Mật Thư"
                  aria-label="Bật/tắt chế độ mật thư"
                >
                  <FileCode className="w-5 h-5" strokeWidth={1.5} />
                </button>

                <button
                  type="button"
                  disabled={connectionStatus !== "connected"}
                  onClick={openFilePicker}
                  className="p-3.5 text-zinc-500 hover:text-zinc-200 bg-zinc-900/50 hover:bg-zinc-800 rounded-full transition-all disabled:opacity-30"
                  aria-label="Đính kèm ảnh"
                >
                  <Paperclip className="w-5 h-5" strokeWidth={1.5} />
                </button>

                <textarea
                  value={inputText}
                  onChange={handleInputChange}
                  disabled={connectionStatus !== "connected"}
                  placeholder={
                    connectionStatus === "connected"
                      ? "Nhập tin nhắn E2EE..."
                      : "Hệ thống chưa sẵn sàng..."
                  }
                  className="flex-1 bg-transparent max-h-32 min-h-[52px] text-[15px] font-light text-zinc-100 placeholder-zinc-600 resize-none py-4 px-2 focus:outline-none scrollbar-hide"
                  rows="1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />

                <button
                  type="submit"
                  disabled={
                    (!inputText.trim() && !previewImage) ||
                    connectionStatus !== "connected"
                  }
                  className={`p-3.5 rounded-full transition-all flex items-center justify-center shrink-0 ${
                    (inputText.trim() || previewImage) &&
                    connectionStatus === "connected"
                      ? "bg-emerald-600 text-white shadow-[0_0_15px_rgba(5,150,105,0.3)] transform hover:scale-105"
                      : "bg-zinc-900/50 text-zinc-600"
                  }`}
                  aria-label="Gửi tin nhắn"
                >
                  <Send className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
