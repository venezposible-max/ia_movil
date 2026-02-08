import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Loader, Bot, User } from 'lucide-react';

// PLAN B: CLAVE INYECTADA DIRECTAMENTE
// Si __GROQ_KEY__ existe (porque Vite la inyectó), úsala. Si no, busca en .env local.
const API_KEY = (typeof __GROQ_KEY__ !== 'undefined' ? __GROQ_KEY__ : '') || import.meta.env.VITE_GROQ_API_KEY || '';

export default function App() {
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState([]);
    const [error, setError] = useState('');
    const [voiceGender, setVoiceGender] = useState('female');

    const [svgContent, setSvgContent] = useState(null);
    const [generatedImage, setGeneratedImage] = useState(null);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState(false);

    const messagesRef = useRef([]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const recognitionRef = useRef(null);
    const synthRef = useRef(window.speechSynthesis);
    const abortControllerRef = useRef(null);

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
                if (e.error !== 'no-speech') setError('Error Voz: ' + e.error);
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

    // PLAN B: SERPER KEY
    const SERPER_API_KEY = (typeof __SERPER_KEY__ !== 'undefined' ? __SERPER_KEY__ : '') || import.meta.env.VITE_SERPER_API_KEY || '';

    const handleUserMessage = async (text) => {
        const currentHistory = messagesRef.current;
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        // INTENCIÓN DE BÚSQUEDA
        const searchKeywords = ['precio', 'noticia', 'última hora', 'sucedió', 'pasó', 'actualidad', 'clima', 'cuánto', 'falleció', 'ganó', 'resultado', 'sismo', 'temblor'];
        const needsSearch = searchKeywords.some(kw => text.toLowerCase().includes(kw));

        let searchContext = '';

        if (needsSearch && SERPER_API_KEY) {
            try {
                console.log("Buscando en Google:", text);
                const searchRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: text, gl: 've', hl: 'es' })
                });
                const searchData = await searchRes.json();
                if (searchData.organic && searchData.organic.length > 0) {
                    // USO CONCATENACIÓN SIMPLE PARA EVITAR ERRORES DE PARSEO
                    const snippets = searchData.organic.slice(0, 3).map(r => 'Title: ' + r.title + '\nSnippet: ' + r.snippet).join('\n\n');
                    searchContext = '\n\n[CONTEXTO DE BÚSQUEDA]:\n' + snippets + '\n\nUsa esto.';
                }
            } catch (e) {
                console.error("Error buscar:", e);
            }
        }

        try {
            if (!API_KEY) throw new Error('Falta la API Key de GROQ en .env');

            const modelToUse = (needsSearch || text.length > 50) ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        {
                            role: "system", content: `Datos: Hoy es ${new Date().toLocaleDateString()}, hora ${new Date().toLocaleTimeString()}. Eres OLGA. 
                        INSTRUCCIONES:
                        1. Mantén el hilo.
                        2. Si preguntan la HORA: Dí SOLO la hora. 
                        3. GENERAR IMAGEN: Si piden imagen, responde SOLO con: "GENERANDO_IMAGEN: [Prompt en ingles]"` },
                        ...currentHistory.slice(-15).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
                        { role: "user", content: text + searchContext }
                    ],
                    temperature: 0.6,
                    max_tokens: 300
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error('Error Groq API');

            const data = await response.json();
            let aiText = data.choices[0].message.content;

            if (aiText.includes('GENERANDO_IMAGEN:')) {
                const prompt = aiText.replace('GENERANDO_IMAGEN:', '').trim();
                const safePrompt = encodeURIComponent(prompt.substring(0, 200));
                const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?nologo=true&width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}`;
                setGeneratedImage(imageUrl);
                setImageLoading(true);
                setImageError(false);
                aiText = "Creando imagen...";
            }

            const cleanText = aiText.replace(/\*/g, '');
            setMessages(prev => [...prev, { role: 'ai', text: cleanText }]);
            speak(cleanText);

        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(err.message);
                setMessages(prev => [...prev, { role: 'ai', text: 'Error: ' + err.message }]);
                speak('Hubo un error.');
            }
        } finally {
            setIsThinking(false);
        }
    };

    const speak = (text) => {
        if (synthRef.current.speaking) synthRef.current.cancel();
        const voiceText = text.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');
        const utterance = new SpeechSynthesisUtterance(voiceText);
        utterance.lang = 'es-US';

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        const voices = synthRef.current.getVoices();
        const esVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));
        const preferredNames = ['Google español', 'Paulina', 'Monica', 'Samantha', 'Helena', 'Sabina', 'Mexico'];
        const bestVoice = esVoices.find(v => preferredNames.some(n => v.name.includes(n)));
        if (bestVoice) utterance.voice = bestVoice;
        else if (esVoices.length > 0) utterance.voice = esVoices[0];

        synthRef.current.speak(utterance);
    };

    const toggleListening = () => {
        if (isSpeaking) {
            synthRef.current.cancel();
            setIsSpeaking(false);
            return;
        }
        if (isThinking) {
            if (abortControllerRef.current) abortControllerRef.current.abort();
            setIsThinking(false);
            return;
        }
        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            setError('');
            recognitionRef.current?.start();
        }
    };

    return (
        <div className='container'>
            <div className='header'>
                <h1>⚡ OLGA AI</h1>
                <p>Neural Network • Llama 3 • Live Search</p>
                <span style={{ fontSize: '0.7rem', color: API_KEY ? '#4caf50' : '#ff5555', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                    {API_KEY ? '✅ Sistema Online' : `❌ Falta API Key (${API_KEY?.length || 0})`}
                </span>
            </div>

            <button
                onClick={() => { setMessages([]); if (isSpeaking) synthRef.current.cancel(); setIsSpeaking(false); setGeneratedImage(null); }}
                style={{
                    position: 'absolute', top: '20px', right: '20px',
                    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
                    width: '40px', height: '40px', cursor: 'pointer', fontSize: '1.2rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
                    color: '#fff'
                }}
                title="Nueva Conversación"
            >
                🗑️
            </button>
            <div className='main-content'>

                {generatedImage && (
                    <div className="art-canvas" style={{
                        marginBottom: '20px', padding: '5px', background: 'rgba(255,255,255,0.1)',
                        borderRadius: '15px', boxShadow: '0 0 40px rgba(188, 19, 254, 0.4)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        overflow: 'hidden', width: '300px', height: '300px',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        position: 'relative'
                    }}>
                        {imageLoading && <div style={{ position: 'absolute', color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '5px 10px', borderRadius: '10px' }}>🎨 Pintando...</div>}

                        {imageError ? (
                            <div style={{ color: '#ff5555', textAlign: 'center', padding: '20px' }}>
                                <p>⚠️ Error de Imagen</p>
                            </div>
                        ) : (
                            <img
                                src={generatedImage}
                                alt="Arte Generado"
                                style={{
                                    width: '100%', height: '100%', borderRadius: '10px', objectFit: 'cover',
                                    opacity: imageLoading ? 0 : 1, transition: 'opacity 0.5s'
                                }}
                                onLoad={() => setImageLoading(false)}
                                onError={() => { setImageLoading(false); setImageError(true); }}
                            />
                        )}
                    </div>
                )}

                <div className='orb-container'>
                    <button
                        className={`orb-button ${isListening ? 'listening' : ''} ${isThinking ? 'thinking' : ''} ${isSpeaking ? 'speaking' : ''}`}
                        onClick={toggleListening}
                    >
                        {isThinking ? <Loader className='icon spin' size={64} /> :
                            isListening ? <Mic className='icon' size={64} /> :
                                isSpeaking ? <Volume2 className='icon' size={64} /> :
                                    <MicOff className='icon' size={64} />}
                    </button>
                    <div className='status-text' style={{ marginTop: '20px' }}>
                        {isListening ? 'Escuchando...' : isThinking ? 'Procesando...' : isSpeaking ? 'Hablando...' : 'Toca para hablar'}
                    </div>
                    {error && <div className='error-msg'>{error}</div>}
                </div>

                <div className='chat-log'>
                    {messages.slice(-2).map((msg, idx) => (
                        <div key={idx} className={`message ${msg.role}`}>
                            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                            <span>{msg.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
