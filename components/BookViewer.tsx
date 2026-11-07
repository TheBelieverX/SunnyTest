import React, { useEffect, useState, useRef } from 'react';
import { Illustration } from '../types';
import { Sparkles, Mic, Maximize2, Minimize2 } from 'lucide-react';
import { DemoPlayer } from './DemoPlayer';
import { IMAGE_MODEL } from '../imageModel';

interface Props {
  currentIllustration: Illustration | null;
  isGenerating: boolean;
  language: 'ro-RO' | 'en-US';
  inSession: boolean;
}

export const BookViewer: React.FC<Props> = ({ currentIllustration, isGenerating, language, inSession }) => {
  const [activeImage, setActiveImage] = useState<Illustration | null>(null);
  const [transitionImage, setTransitionImage] = useState<Illustration | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    if (!currentIllustration) {
      setActiveImage(null);
      setTransitionImage(null);
      setIsTransitioning(false);
      return;
    }

    // Initial load
    if (!activeImage) {
      setActiveImage(currentIllustration);
      return;
    }

    // New image arrived
    if (currentIllustration.id !== activeImage.id) {
      setTransitionImage(currentIllustration);
      setIsTransitioning(true);

      // Wait for transition animation to complete then swap
      const timer = setTimeout(() => {
        setActiveImage(currentIllustration);
        setTransitionImage(null);
        setIsTransitioning(false);
      }, 1200); // Matches CSS duration

      return () => clearTimeout(timer);
    }

    setTransitionImage(null);
    setIsTransitioning(false);
  }, [currentIllustration, activeImage]);

  // Determine if we are in the "Empty/Start" state
  const hasImages = activeImage || transitionImage;

  return (
    <div 
      ref={containerRef}
      className={`${
        isFullscreen 
          ? 'fixed inset-0 z-[9999] w-screen h-screen bg-black flex items-center justify-center' 
          : 'relative w-full aspect-square md:aspect-[4/3] bg-white rounded-lg shadow-2xl border-[12px] border-white ring-1 ring-gray-200'
      } overflow-hidden transition-all duration-500 group`}
    >
      {/* State 1: Empty Placeholder */}
      {!hasImages && !isGenerating && !inSession && <DemoPlayer language={language} />}

      {/* Listening, no image yet */}
      {!hasImages && !isGenerating && inSession && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-magic-50">
          <div className="bg-magic-500 text-white p-5 rounded-full mb-4 animate-pulse">
            <Mic className="w-10 h-10" />
          </div>
          <p className="text-lg font-display font-bold text-magic-800">
            {language === 'ro-RO' ? 'Te ascult... citește mai departe și vor apărea imagini despre povestea ta.' : "I'm listening... keep reading and pictures will appear about your story."}
          </p>
        </div>
      )}

      {/* State 2: Active Image Logic */}
      {hasImages && (
        <>
          {/* Base Layer (Current Image) */}
          {activeImage && (
            <div className="absolute inset-0 w-full h-full">
              <img 
                src={activeImage.url} 
                alt={language === 'ro-RO' ? 'Scena curentă' : 'Current Scene'} 
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Transition Layer (New Image Fading In) */}
          {transitionImage && (
            <div 
              className={`absolute inset-0 z-10 w-full h-full transition-all duration-[1200ms] ease-in-out ${isTransitioning ? 'opacity-100 scale-100' : 'opacity-0 scale-105'}`}
            >
              <img 
                src={transitionImage.url} 
                alt={language === 'ro-RO' ? 'Scena următoare' : 'Next Scene'} 
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </>
      )}

      {/* Loading Overlay */}
      {isGenerating && !isTransitioning && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg flex items-center gap-3 animate-bounce">
            <Sparkles className="w-5 h-5 text-magic-500 animate-spin" />
            <span className="font-display font-bold text-magic-800">{language === 'ro-RO' ? 'Se pictează...' : 'Painting...'}</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 z-30 max-w-[calc(100%-1rem)] rounded bg-black/60 px-2 py-1 text-[10px] leading-tight text-white backdrop-blur-sm">
        {language === 'ro-RO' ? 'Model imagini' : 'Image model'}: {IMAGE_MODEL}
      </div>

      {/* Fullscreen Toggle Button - Always Visible now */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-4 right-4 z-30 p-3 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-sm transition-all duration-200"
        title={isFullscreen
          ? (language === 'ro-RO' ? 'Ieși din ecran complet' : 'Exit Fullscreen')
          : (language === 'ro-RO' ? 'Ecran complet' : 'Enter Fullscreen')}
      >
        {isFullscreen ? <Minimize2 size={24} /> : <Maximize2 size={24} />}
      </button>
    </div>
  );
};