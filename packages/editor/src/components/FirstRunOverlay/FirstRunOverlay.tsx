import { Icon } from '@varve/ui';
import { useEffect, useState } from 'react';
import './FirstRunOverlay.css';

const FIRST_RUN_KEY = 'varve:first-run-overlay:dismissed';

interface FirstRunOverlayProps {
  onDismiss?: () => void;
}

export function FirstRunOverlay({ onDismiss }: FirstRunOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(FIRST_RUN_KEY);
      if (!dismissed) {
        setVisible(true);
      }
    } catch {
      // Storage unavailable, don't show overlay
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(FIRST_RUN_KEY, 'true');
    } catch {
      // Storage unavailable, dismiss anyway
    }
    setVisible(false);
    onDismiss?.();
  };

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!visible) {
    return null;
  }

  const steps: Array<{
    title: string;
    description: string;
    icon: 'Sparkles' | 'Keyboard' | 'CircleHelp';
  }> = [
    {
      title: 'Welcome to Varve',
      description: 'Design, illustrate, and publish — locally, without subscriptions.',
      icon: 'Sparkles',
    },
    {
      title: 'Tools at Your Fingertips',
      description: 'Press V for Select, R for Rectangle, T for Text. All tools have shortcuts.',
      icon: 'Keyboard',
    },
    {
      title: 'Get Help Anytime',
      description: 'Press F1 for help, or visit the Start Here guide for a quick walkthrough.',
      icon: 'CircleHelp',
    },
  ];

  const step = steps[currentStep];
  if (!step) return null;

  return (
    <div className="first-run-overlay">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is decorative, close button provides keyboard access */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop provides alternate dismiss path, not primary interaction */}
      <div className="first-run-backdrop" onClick={handleDismiss} />
      <div className="first-run-content">
        <button
          type="button"
          className="first-run-close"
          onClick={handleDismiss}
          aria-label="Close"
        >
          <Icon name="X" size={20} />
        </button>

        <div className="first-run-body">
          <div className="first-run-icon">
            <Icon name={step.icon} size={48} />
          </div>
          <h2 className="first-run-title">{step.title}</h2>
          <p className="first-run-description">{step.description}</p>

          {currentStep === 2 && (
            <a
              href="https://varve.studio/docs/start-here?ref=first-run-overlay"
              target="_blank"
              rel="noopener noreferrer"
              className="first-run-link"
            >
              Open Start Here Guide
            </a>
          )}
        </div>

        <div className="first-run-footer">
          <div className="first-run-dots">
            {steps.map((s, index) => (
              <button
                key={s.title}
                type="button"
                className={`first-run-dot ${index === currentStep ? 'active' : ''}`}
                onClick={() => setCurrentStep(index)}
                aria-label={`Go to step ${index + 1}`}
              />
            ))}
          </div>

          <div className="first-run-actions">
            {currentStep > 0 && (
              <button
                type="button"
                className="first-run-button first-run-button--secondary"
                onClick={handlePrevious}
              >
                Previous
              </button>
            )}
            <button
              type="button"
              className="first-run-button first-run-button--primary"
              onClick={handleNext}
            >
              {currentStep < 2 ? 'Next' : 'Get Started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
