import { useEffect, useState } from 'react';

/**
 * The browser's "install this app" offer. It fires once, early, so it's caught here at
 * startup and kept until the person asks to install.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export type InstallState = 'installed' | 'ready' | 'ios' | 'insecure' | 'menu';

function currentState(): InstallState {
  if (window.matchMedia('(display-mode: standalone)').matches) return 'installed';
  if (deferred) return 'ready';
  if (!window.isSecureContext) return 'insecure';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'ios';
  return 'menu';
}

export function useInstall() {
  const [state, setState] = useState<InstallState>(currentState);
  useEffect(() => {
    const update = () => setState(currentState());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return {
    state,
    async install() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      notify();
    },
  };
}
