
import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Music, Radio, SkipForward } from 'lucide-react';

const RadioPlayer = ({ genre, autoPlay = false, onStop }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [station, setStation] = useState(null);
    const [stationsList, setStationsList] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const audioRef = useRef(new Audio());
    const userStoppedRef = useRef(false);

    // MODO BOOST (Amplificación)
    const [boostEnabled, setBoostEnabled] = useState(false);
    const audioContextRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const gainNodeRef = useRef(null);

    useEffect(() => {
        if (genre) {
            userStoppedRef.current = false;
            findStations(genre);
        }
        return () => {
            stopAudio();
        };
    }, [genre]);

    // Gestión de parada forzada si genre es null
    useEffect(() => {
        if (!genre && audioRef.current) {
            stopAudio();
        }
    }, [genre]);

    const stopAudio = () => {
        userStoppedRef.current = true;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            // IMPORTANTE: Quitar anonymous por defecto para evitar bloqueos CORS en prox. carga
            audioRef.current.removeAttribute('crossorigin');
        }
        setIsPlaying(false);
        setStation(null);
        setBoostEnabled(false);
        if (onStop) onStop();
    };

    const findStations = async (searchGenre) => {
        setLoading(true);
        setError('');
        setIsPlaying(false);
        setStationsList([]);
        setCurrentIndex(0);

        try {
            let rawGenre = searchGenre.trim().toLowerCase().replace('música ', '').replace('musica ', '');
            const genreMap = {
                'venezolana': 'venezuela',
                'venezuela': 'venezuela',
                'colombiana': 'colombia',
                'mexicana': 'mexico',
                'romántica': 'romantic',
                'urbana': 'urban',
                'lo-fi': 'lofi',
                'lo fi': 'lofi',
                'reguetón': 'reggaeton',
                'salsa': 'salsa'
            };

            const safeGenre = genreMap[rawGenre] || rawGenre;
            const res = await fetch(`https://de1.api.radio-browser.info/json/stations/bytag/${safeGenre}?limit=20&order=votes&reverse=true`);
            const data = await res.json();

            if (data && data.length > 0) {
                const shuffled = data.sort(() => 0.5 - Math.random());
                setStationsList(shuffled);
                playStationByIndex(0, shuffled);
            } else {
                setError(`No hay radios de "${safeGenre}".`);
            }
        } catch (e) {
            setError("Error de red.");
        } finally {
            setLoading(false);
        }
    };

    const playStationByIndex = (index, list = stationsList) => {
        if (!list || list.length === 0 || index >= list.length) {
            setError("Fin de lista.");
            setIsPlaying(false);
            setLoading(false);
            return;
        }

        if (userStoppedRef.current && index > 0) return;
        userStoppedRef.current = false;

        const nextStation = list[index];
        setStation(nextStation);
        setCurrentIndex(index);
        setError('');
        setLoading(true);

        try {
            audioRef.current.pause();
            // NO PONER anonymous AQUÍ. Dejar que cargue normal para evitar bloqueos.
            audioRef.current.src = nextStation.url_resolved;
            audioRef.current.load();

            audioRef.current.play()
                .then(() => {
                    setIsPlaying(true);
                    setLoading(false);
                })
                .catch(e => {
                    console.warn("Fallo play:", nextStation.name);
                    if (!userStoppedRef.current) tryNextStation(index + 1, list);
                });
        } catch (e) {
            if (!userStoppedRef.current) tryNextStation(index + 1, list);
        }
    };

    const tryNextStation = (nextIdx, list) => {
        if (nextIdx < list.length) {
            setTimeout(() => playStationByIndex(nextIdx, list), 300);
        } else {
            setError("Sin emisoras activas.");
            setIsPlaying(false);
            setLoading(false);
        }
    };

    const togglePlay = () => {
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play().catch(() => tryNextStation(currentIndex + 1, stationsList));
            setIsPlaying(true);
        }
    };

    const toggleBoost = async () => {
        if (!audioRef.current) return;

        try {
            // Activar AudioContext con el primer click de Boost
            if (!audioContextRef.current) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                audioContextRef.current = new AudioContext();
                gainNodeRef.current = audioContextRef.current.createGain();
                gainNodeRef.current.connect(audioContextRef.current.destination);
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            if (!boostEnabled) {
                // Para el Boost SÍ necesitamos anonymous. 
                // Si la radio no tiene CORS, esto dará error y avisaremos al usuario.
                audioRef.current.crossOrigin = "anonymous";

                if (!sourceNodeRef.current) {
                    try {
                        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
                        sourceNodeRef.current.connect(gainNodeRef.current);
                    } catch (e) {
                        setError("CORS: Esta radio no permite Boost.");
                        audioRef.current.removeAttribute('crossorigin');
                        return;
                    }
                }
                gainNodeRef.current.gain.value = 2.5;
                setBoostEnabled(true);
            } else {
                gainNodeRef.current.gain.value = 1.0;
                setBoostEnabled(false);
            }
        } catch (e) {
            console.error("Boost Error:", e);
            setError("Error al activar Boost.");
        }
    };

    if (!genre && !station) return null;

    return (
        <div style={{
            position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(15px)',
            border: `1px solid ${boostEnabled ? '#ff0055' : '#00f3ff'}`,
            borderRadius: '20px', padding: '12px 18px',
            display: 'flex', alignItems: 'center', gap: '15px', zIndex: 1000,
            minWidth: '320px', maxWidth: '95%', transition: 'all 0.3s'
        }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {loading ? "Sintonizando..." : (station ? station.name : "Radio")}
                </div>
                <div style={{ fontSize: '0.7rem', color: boostEnabled ? '#ff0055' : '#00f3ff' }}>
                    {boostEnabled ? "🚀 BOOST ACTIVO" : (isPlaying ? "Reproduciendo" : "Pausado")}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={toggleBoost} style={{
                    background: boostEnabled ? '#ff0055' : '#222', border: 'none', borderRadius: '8px', padding: '5px 8px',
                    color: '#fff', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer'
                }}>🚀</button>

                <button onClick={() => tryNextStation(currentIndex + 1, stationsList)} style={{ background: 'none', border: 'none', color: '#fff' }}><SkipForward size={20} /></button>

                <button onClick={togglePlay} style={{ background: boostEnabled ? '#ff0055' : '#00f3ff', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isPlaying ? <Pause size={20} color="#000" /> : <Play size={20} color="#000" style={{ marginLeft: '2px' }} />}
                </button>

                <button onClick={stopAudio} style={{ background: 'none', border: 'none', color: '#ff5555' }}><Square size={16} /></button>
            </div>
            {error && <div style={{ position: 'absolute', bottom: '-22px', left: 0, width: '100%', color: '#ff5555', fontSize: '0.7rem', textAlign: 'center' }}>{error}</div>}
        </div>
    );
};

export default RadioPlayer;
