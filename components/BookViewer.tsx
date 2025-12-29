import React, { useEffect, useState, useRef } from 'react';
import { Illustration } from '../types';
import { Sparkles, Maximize2, Minimize2 } from 'lucide-react';

interface Props {
  currentIllustration: Illustration | null;
  isGenerating: boolean;
}

export const BookViewer: React.FC<Props> = ({ currentIllustration, isGenerating }) => {
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
    // Initial load
    if (currentIllustration && !activeImage) {
      setActiveImage(currentIllustration);
      return;
    }

    // New image arrived
    if (currentIllustration && activeImage && currentIllustration.id !== activeImage.id) {
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
      {!hasImages && !isGenerating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white">
          <div className="bg-magic-50 p-6 rounded-full mb-4">
            <Sparkles className="w-12 h-12 text-magic-300" />
          </div>
          <h3 className="text-xl font-display text-magic-800 font-bold mb-2">Cartea este deschisă...</h3>
          <p className="text-gray-500">Începe să citești pentru a vedea magia.</p>
          <p className="text-sm text-gray-400 mt-1">(The book is open. Start reading to see magic.)</p>
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
                alt="Current Scene" 
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
                alt="Next Scene" 
                className="w-full h-full object-cover"
              />
              {/* Flash effect for magic */}
              <div className={`absolute inset-0 bg-white mix-blend-overlay transition-opacity duration-[600ms] ${isTransitioning ? 'opacity-30' : 'opacity-0'}`}></div>
            </div>
          )}
        </>
      )}

      {/* Loading Overlay */}
      {isGenerating && !isTransitioning && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg flex items-center gap-3 animate-bounce">
            <Sparkles className="w-5 h-5 text-magic-500 animate-spin" />
            <span className="font-display font-bold text-magic-800">Se pictează... (Painting...)</span>
          </div>
        </div>
      )}

      {/* Fullscreen Toggle Button - Always Visible now */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-4 right-4 z-30 p-3 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-sm transition-all duration-200"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? <Minimize2 size={24} /> : <Maximize2 size={24} />}
      </button>
    </div>
  );
};