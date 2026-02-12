
import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';

const EmotionEffects = ({ trigger }) => {
    useEffect(() => {
        if (!trigger) return;

        // ❤️ AMOR / CARIÑO (CORAZONES MEJORADOS)
        if (trigger === 'LOVE') {
            const end = Date.now() + 1500;

            (function frame() {
                confetti({
                    particleCount: 7,
                    angle: 60,
                    spread: 80,
                    origin: { x: 0, y: 0.7 }, // Desde los lados, más arriba
                    colors: ['#FF0000', '#FF1493', '#FF69B4'],
                    shapes: ['heart'], // INTENTO CORAZON
                    disableForReducedMotion: true,
                    scalar: 3 // MÁS GRANDES
                });
                confetti({
                    particleCount: 7,
                    angle: 120,
                    spread: 80,
                    origin: { x: 1, y: 0.7 },
                    colors: ['#FF0000', '#FF1493', '#FF69B4'],
                    shapes: ['heart'],
                    scalar: 3
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            }());
        }

        // 🎉 CELEBRACIÓN / ÉXITO (MÁS FIESTA)
        if (trigger === 'PARTY') {
            confetti({
                particleCount: 200,
                spread: 100,
                origin: { y: 0.6 },
                colors: ['#FFD700', '#00FF00', '#00BFFF', '#FF4500'],
                scalar: 1.2
            });
        }

        // 🔥 PASIÓN / FIRE (VOLCÁN)
        if (trigger === 'FIRE') {
            const duration = 2000;
            const end = Date.now() + duration;

            (function frame() {
                // Lanza desde abajo centro hacia arriba
                confetti({
                    particleCount: 15,
                    startVelocity: 55, // Más rápido hacia arriba
                    spread: 60,
                    origin: { x: 0.5, y: 1 }, // Abajo centro
                    colors: ['#FF4500', '#FF0000', '#FFA500', '#FFFF00'], // Rojos, naranjas, amarillos
                    shapes: ['circle'], // Chispas redondas
                    scalar: 0.8, // Pequeñas como chispas
                    gravity: 0.8,
                    drift: 0,
                    ticks: 100
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            }());
        }

        // 💡 IDEA / MAGIC (ESTRELLAS)
        if (trigger === 'MAGIC') {
            confetti({
                particleCount: 80,
                spread: 360,
                startVelocity: 40,
                origin: { x: 0.5, y: 0.5 }, // Centro pantalla
                colors: ['#FFFFFF', '#00FFFF', '#FF00FF', '#FFFF00'],
                shapes: ['star'], // Estrellas
                scalar: 1.5,
                gravity: 0.2
            });
        }

    }, [trigger]);

    return null;
};

export default EmotionEffects;
