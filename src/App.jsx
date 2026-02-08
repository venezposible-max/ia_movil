import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, User } from 'lucide-react';

// PLAN B: CLAVE INYECTADA DIRECTAMENTE
const API_KEY = (typeof __GROQ_KEY__ !== 'undefined' ? __GROQ_KEY__ : '') || import.meta.env.VITE_GROQ_API_KEY || '';

export default function App() {
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState([]);
    const [error, setError] = useState('');

    // DATOS DE USUARIO (PERSISTENTES)
    const [userName, setUserName] = useState(() => localStorage.getItem('olga_user_name') || '');
    const [userBirthDate, setUserBirthDate] = useState(() => localStorage.getItem('olga_user_birth') || '');
    const [showSettings, setShowSettings] = useState(false);

    // REFS
    const userNameRef = useRef(userName);
    const userBirthDateRef = useRef(userBirthDate);
    const messagesRef = useRef([]);
    const recognitionRef = useRef(null);
    const synthRef = useRef(window.speechSynthesis);
    const abortControllerRef = useRef(null);

    // ESTADOS CÁMARA & IMAGEN
    const [showCamera, setShowCamera] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [generatedImage, setGeneratedImage] = useState(null);
    const [imageLoading, setImageLoading] = useState(false);

    useEffect(() => {
        userNameRef.current = userName;
        userBirthDateRef.current = userBirthDate;
        localStorage.setItem('olga_user_name', userName);
        localStorage.setItem('olga_user_birth', userBirthDate);
    }, [userName, userBirthDate]);

    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // --- RECONOCIMIENTO DE VOZ ---
    useEffect(() => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'es-419';

            recognition.onstart = () => { setIsListening(true); setError(''); };
            recognition.onend = () => { setIsListening(false); };
            recognition.onerror = (e) => {
                if (e.error === 'no-speech') return;
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    setError(isIOS ? '🍎 En iPhone usa Safari.' : '⚠️ Micrófono bloqueado.');
                } else {
                    setError('Error Voz: ' + e.error);
                }
                setIsListening(false);
            };
            recognition.onresult = (e) => {
                const t = e.results[0][0].transcript;
                if (t.trim()) handleUserMessage(t);
            };
            recognitionRef.current = recognition;
        } else {
            setError('Navegador no compatible. Usa Chrome.');
        }
    }, []);

    // --- FUNCIONES CÁMARA ---
    const startCamera = async () => {
        try {
            setShowCamera(true);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (videoRef.current) { videoRef.current.srcObject = stream; }
        } catch (err) {
            setError('Error Cámara: ' + err.message);
            setShowCamera(false);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setShowCamera(false);
    };

    const analyzeImage = async () => {
        if (!videoRef.current || !canvasRef.current) return;
        setIsAnalyzing(true);
        speak("Déjame ver...");

        const context = canvasRef.current.getContext('2d');
        const MAX_WIDTH = 512;
        let width = videoRef.current.videoWidth;
        let height = videoRef.current.videoHeight;
        if (width > MAX_WIDTH) { const s = MAX_WIDTH / width; width = MAX_WIDTH; height = height * s; }

        canvasRef.current.width = width; canvasRef.current.height = height;
        context.drawImage(videoRef.current, 0, 0, width, height);
        const imageBase64 = canvasRef.current.toDataURL('image/jpeg', 0.6);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct",
                    messages: [
                        { role: "user", content: [{ type: "text", text: `Describe BREVEMENTE qué ves. Eres OLGA.` }, { type: "image_url", image_url: { url: imageBase64 } }] }
                    ],
                    max_tokens: 150
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || 'Error API Vision');
            const description = data.choices[0].message.content;

            setMessages(prev => [...prev, { role: 'ai', text: "[👁️ VEO]: " + description }]);
            speak(description);
        } catch (e) {
            console.error(e);
            speak("No pude ver bien.");
            alert("Error Visión: " + e.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // --- LÓGICA CORE ---
    const SERPER_API_KEY = (typeof __SERPER_KEY__ !== 'undefined' ? __SERPER_KEY__ : '') || import.meta.env.VITE_SERPER_API_KEY || '';

    const handleUserMessage = async (text) => {
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        // 1. CRIPTO CHECK
        let searchContext = '';
        const cryptoMap = { 'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT', 'solana': 'SOLUSDT' };
        let cryptoSymbol = null;
        for (const [key, val] of Object.entries(cryptoMap)) { if (text.toLowerCase().includes(key)) { cryptoSymbol = val; break; } }

        if (cryptoSymbol) {
            try {
                const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cryptoSymbol}`);
                const data = await res.json();
                if (data.price) searchContext = `[PRECIO ${cryptoSymbol}: $${parseFloat(data.price).toFixed(2)}] `;
            } catch (e) { }
        }

        // 2. GOOGLE CHECK
        /* (Simplificado para brevedad, mantener lógica Serper si es vital) */

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: `Eres OLGA. Usuario: ${userNameRef.current}. Responde breve y con personalidad.` },
                        ...messagesRef.current.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
                        { role: "user", content: text + searchContext }
                    ],
                    max_tokens: 300
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error('Error Groq');
            const data = await response.json();
            const aiText = data.choices[0].message.content;

            if (aiText.includes('GENERANDO_IMAGEN:')) {
                // ... lógica imagen
                setMessages(prev => [...prev, { role: 'ai', text: "Generando imagen..." }]);
            } else {
                setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
                speak(aiText);
            }

        } catch (e) {
            if (e.name !== 'AbortError') {
                setMessages(prev => [...prev, { role: 'ai', text: "Error: " + e.message }]);
                speak("Error.");
            }
        } finally {
            setIsThinking(false);
        }
    };

    const speak = (text) => {
        if (synthRef.current.speaking) synthRef.current.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-US';
        u.onstart = () => setIsSpeaking(true);
        u.onend = () => setIsSpeaking(false);
        synthRef.current.speak(u);
    };

    const toggleListening = () => {
        if (isSpeaking) { synthRef.current.cancel(); setIsSpeaking(false); return; }
        if (isThinking) return;
        if (isListening) recognitionRef.current?.stop();
        else {
            const wakeUp = new SpeechSynthesisUtterance(" ");
            wakeUp.volume = 0;
            synthRef.current.speak(wakeUp);
            setError('');
            recognitionRef.current?.start();
        }
    };

    // --- NUEVO DESIGN SYSTEM MÓVIL ---
    return (
        <div className="mobile-layout">

            {/* 1. HEADER */}
            <div className="header-compact">
                <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.4rem' }}>⚡</span> OLGA
                    <span style={{ fontSize: '0.6rem', opacity: 0.5, letterSpacing: '2px', fontWeight: 400 }}>AI VISION</span>
                </div>
                <div className="status-dot" style={{ color: API_KEY ? '#00ff88' : '#ff5555' }}>
                    {API_KEY ? 'ONLINE' : 'OFFLINE'}
                </div>
            </div>

            {/* 2. CHAT AREA */}
            <div className="content-area">
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', opacity: 0.3, marginTop: '50px' }}>
                        <p>Soy OLGA. Toca el núcleo para hablar.</p>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`chat-bubble ${msg.role}`}>
                        {msg.text}
                    </div>
                ))}

                {error && <div className="error-toast">⚠️ {error}</div>}
            </div>

            {/* 3. DOCK CONTROL V2 */}
            <div className="control-dock">
                <button className="dock-btn vision" onClick={startCamera}>👁️</button>

                <div
                    className={`orb-core ${isListening ? 'listening' : isThinking ? 'thinking' : isSpeaking ? 'speaking' : ''}`}
                    onClick={toggleListening}
                >
                    <div className="orb-icon">
                        {isThinking ? '⏳' : isSpeaking ? '🔊' : isListening ? '🎙️' : '🧠'}
                    </div>
                </div>

                <button className="dock-btn" onClick={() => setShowSettings(true)}>⚙️</button>
            </div>

            {/* --- OVERLAYS --- */}

            {/* CAMARA - CAPA SUPERIOR */}
            {showCamera && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh',
                    background: '#000', zIndex: 99999, display: 'flex', flexDirection: 'column'
                }}>
                    <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    <button onClick={stopCamera} style={{
                        position: 'absolute', top: '40px', left: '20px',
                        background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%',
                        width: '40px', height: '40px', fontSize: '1.2rem', cursor: 'pointer', zIndex: 100
                    }}>✕</button>

                    <button onClick={analyzeImage} disabled={isAnalyzing} style={{
                        position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)',
                        background: '#fff', width: '80px', height: '80px', borderRadius: '50%',
                        border: '5px solid rgba(255,255,255,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem'
                    }}>
                        {isAnalyzing ? '⏳' : '📸'}
                    </button>
                </div>
            )}

            {/* SETTINGS MODAL */}
            {showSettings && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh',
                    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(15px)', zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
                }}>
                    <div style={{ width: '100%', maxWidth: '350px', background: '#1a1a2e', borderRadius: '24px', padding: '24px', border: '1px solid #333' }}>
                        <h2 style={{ margin: '0 0 20px 0', fontSize: '1.2rem', color: '#fff', textAlign: 'center' }}>Ajustes</h2>

                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '5px' }}>Nombre</label>
                        <input
                            type="text" defaultValue={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            style={{ width: '100%', padding: '12px', background: '#222', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '15px' }}
                        />

                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button onClick={() => { if (confirm('¿Borrar?')) { setMessages([]); window.location.reload(); } }} style={{ flex: 1, padding: '12px', background: 'rgba(255,50,50,0.1)', color: '#ff5555', border: 'none', borderRadius: '12px' }}>Reset</button>
                            <button onClick={() => setShowSettings(false)} style={{ flex: 1, padding: '12px', background: '#00f3ff', color: '#000', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>Listo</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
