'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  isSummaryDone?: boolean;
  timerSecondsLeft?: number;
  isTimerRunning?: boolean;
};

type UserProfile = {
  name: string;
  occupation: string;
  goals: string;
  challenges: string;
};

type PersonalNote = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
};

type Commitment = {
  id: string;
  text: string;
  date: string;
  done: boolean;
};

interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: any) => void) | null;
}

interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

const STORAGE_KEY = 'peter_daniels_conversations_v1';
const ACTIVE_CONV_KEY = 'peter_daniels_active_conv_id';
const PROFILE_KEY = 'peter_daniels_user_profile_v1';
const NOTES_KEY = 'peter_daniels_user_notes_v1';
const COMMITMENTS_KEY = 'peter_daniels_commitments_v1';
const AUTH_EMAIL_KEY = 'peter_daniels_auth_email_v1';
const THEME_KEY = 'peter_daniels_theme_v1';

// Helper to extract numbered or bulleted action items from text
function extractActionItems(text: string): string[] {
  if (!text) return [];

  // 1. Locate the commitment header section if present
  const headerRegex = /(?:###\s*🎯?\s*(?:Твои\s+обязательства|Обязательства|Шаги-обязательства|Action\s+Commitments)|(?:обязательства\s+к\s+действию|шаги-обязательства|итог\s+и\s+план):?)/i;
  const match = text.match(headerRegex);

  // If there is an explicit header, parse strictly AFTER this header so questions in preamble are ignored
  const targetText = match && match.index !== undefined ? text.slice(match.index) : text;

  const lines = targetText.split('\n');
  const items: string[] = [];
  
  const itemPattern = /^(?:(?:\d+[\.\)]|\*|-|•)\s+)(.+)$/;
  
  for (const line of lines) {
    const trimmed = line.trim();
    const lineMatch = trimmed.match(itemPattern);
    if (lineMatch) {
      let clean = lineMatch[1].trim();
      if (
        clean.length > 15 &&
        !clean.toLowerCase().startsWith('благослов') &&
        !clean.toLowerCase().startsWith('напутств') &&
        !clean.toLowerCase().startsWith('вопрос')
      ) {
        // Strip markdown bold/italic asterisks completely: ** or *
        clean = clean.replace(/\*+/g, '').replace(/^[0-9]+[\.\)]\s*/, '').trim();
        items.push(clean);
      }
    }
  }

  // If regex found 0 items, look for paragraphs starting with 1., 2., 3.
  if (items.length === 0) {
    for (const line of lines) {
      let trimmed = line.trim();
      if ((trimmed.startsWith('1.') || trimmed.startsWith('2.') || trimmed.startsWith('3.')) && trimmed.length > 15) {
        trimmed = trimmed.replace(/^[0-9]+[\.\)]\s*/, '').replace(/\*+/g, '').trim();
        items.push(trimmed);
      }
    }
  }

  return items.slice(0, 5); // limit to 5 candidate tasks
}

// Smart filter: check if message contains final Phase 3 action commitments
function hasActionCommitments(text: string, msgIndex?: number, allMessages?: Message[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Strict commitment headers (Phase 3 Final Commitments or explicit Session Summary)
  // NEVER trigger on solitary 🎯 emoji!
  const hasDefinitiveCommitmentHeader =
    lower.includes('обязательства к действию') ||
    lower.includes('твои обязательства') ||
    lower.includes('обязательства на сегодня') ||
    lower.includes('шаги-обязательства') ||
    lower.includes('action commitments') ||
    lower.includes('commitments to execute') ||
    lower.includes('итог и план:');

  if (!hasDefinitiveCommitmentHeader) {
    return false;
  }

  // Check turn stage: if this is the first assistant response, the user has not yet replied to Peter's diagnostic questions
  if (allMessages && typeof msgIndex === 'number') {
    const priorUserMessages = allMessages.slice(0, msgIndex).filter((m) => m.role === 'user');
    if (priorUserMessages.length <= 1) {
      const firstUserText = (priorUserMessages[0]?.content || '').toLowerCase();
      const isExplicitSummaryRequest =
        firstUserText.includes('итог') ||
        firstUserText.includes('план') ||
        firstUserText.includes('обязательств');
      if (!isExplicitSummaryRequest) {
        return false;
      }
    }
  }

  // If message is still asking for ongoing diagnostic / clarifying input:
  const isContinuingDiscussion =
    lower.includes('напиши мне его суть') ||
    lower.includes('напиши мне суть') ||
    lower.includes('ответь мне на три') ||
    lower.includes('ответь мне на мои вопросы') ||
    lower.includes('диагностических вопрос') ||
    lower.includes('три диагностических') ||
    lower.includes('жду твоего ответа');

  if (isContinuingDiscussion && !lower.includes('обязательства к действию')) {
    return false;
  }

  const items = extractActionItems(text);
  return items.length > 0;
}

export default function ChatPage() {
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Email Auth State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authNameInput, setAuthNameInput] = useState<string>('');
  const [authEmailInput, setAuthEmailInput] = useState<string>('');
  const [authPasswordInput, setAuthPasswordInput] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [welcomeBanner, setWelcomeBanner] = useState<string>('');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Profile, Notes & Commitments
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: '',
    occupation: '',
    goals: '',
    challenges: '',
  });
  const [personalNotes, setPersonalNotes] = useState<PersonalNote[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newCommitmentText, setNewCommitmentText] = useState('');

  // Commitment Selection Modal (Decision & Free Will)
  const [isCommitSelectionModalOpen, setIsCommitSelectionModalOpen] = useState(false);
  const [proposedCommitments, setProposedCommitments] = useState<{ id: string; text: string; selected: boolean }[]>([]);
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);
  const [celebratedCount, setCelebratedCount] = useState(0);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced');

  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextAutoPushRef = useRef(false);

  // Cloud Sync: Fetch from Supabase by Email
  const pullFromCloud = async (emailToPull: string) => {
    const k = (emailToPull || '').trim().toLowerCase();
    if (!k) return;
    try {
      setSyncStatus('syncing');
      const res = await fetch(`/api/sync?key=${encodeURIComponent(k)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const { profile, conversations: cloudConvs, commitments: cloudCommits, notes: cloudNotes } = json.data;
          if (profile && Object.keys(profile).length > 0) {
            setUserProfile(profile);
            localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
          } else {
            const defProf = { name: '', occupation: '', goals: '', challenges: '' };
            setUserProfile(defProf);
            localStorage.setItem(PROFILE_KEY, JSON.stringify(defProf));
          }

          if (Array.isArray(cloudConvs) && cloudConvs.length > 0) {
            setConversations(cloudConvs);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudConvs));
            if (!activeId || !cloudConvs.some((c) => c.id === activeId)) {
              setActiveId(cloudConvs[0].id);
            }
          } else {
            const freshId = 'conv_' + Date.now();
            const freshConv: Conversation = {
              id: freshId,
              title: 'Новый диалог',
              messages: [],
              updatedAt: Date.now(),
              timerSecondsLeft: 30 * 60,
              isTimerRunning: false,
            };
            setConversations([freshConv]);
            localStorage.setItem(STORAGE_KEY, JSON.stringify([freshConv]));
            setActiveId(freshId);
          }

          const commits = Array.isArray(cloudCommits) ? cloudCommits : [];
          setCommitments(commits);
          localStorage.setItem(COMMITMENTS_KEY, JSON.stringify(commits));

          const notes = Array.isArray(cloudNotes) ? cloudNotes : [];
          setPersonalNotes(notes);
          localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        }
      }
      setSyncStatus('synced');
    } catch {
      setSyncStatus('offline');
    }
  };

  // Cloud Sync: Push to Supabase by Email
  const pushToCloud = async (
    profileData = userProfile,
    convsData = conversations,
    commsData = commitments,
    notesData = personalNotes,
    email = authEmail
  ) => {
    try {
      const k = (email || '').trim().toLowerCase();
      if (!k) return;

      let finalProfile = { ...profileData };
      if (!finalProfile.name || !finalProfile.name.trim()) {
        try {
          const saved = localStorage.getItem(PROFILE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.name && parsed.name.trim()) {
              finalProfile.name = parsed.name.trim();
            }
          }
        } catch {
          // ignore
        }
      }

      setSyncStatus('syncing');
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userKey: k,
          profile: finalProfile,
          conversations: convsData,
          commitments: commsData,
          notes: notesData,
        }),
      });
      setSyncStatus('synced');
    } catch {
      setSyncStatus('offline');
    }
  };

  // Global browser event & unhandled rejection safety shield
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Suppress unhandled browser Event rejections (e.g. SpeechRecognitionErrorEvent, network Abort, DOM Events)
      if (
        !event.reason ||
        event.reason instanceof Event ||
        (typeof event.reason === 'object' && !('message' in event.reason) && !('stack' in event.reason))
      ) {
        event.preventDefault();
        event.stopPropagation();
        console.warn('Safely prevented unhandled Event rejection:', event.reason);
      }
    };

    const handleGlobalError = (event: ErrorEvent) => {
      if (
        !event.error &&
        (event.message === 'Script error.' || typeof event.message !== 'string' || !event.message)
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);
    window.addEventListener('error', handleGlobalError, true);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true);
      window.removeEventListener('error', handleGlobalError, true);
    };
  }, []);

  // 0. Theme initialization & toggle
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (savedTheme === 'dark') {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
        } else {
          document.documentElement.classList.add('light');
          document.documentElement.classList.remove('dark');
        }
      } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light');
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      } else {
        setTheme('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      }
    } catch (e) {
      console.error('Failed to init theme:', e);
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
      document.documentElement.setAttribute('data-theme', nextTheme);
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  };

  // 1. Initial Load from LocalStorage
  useEffect(() => {
    const savedEmail = localStorage.getItem(AUTH_EMAIL_KEY);
    if (savedEmail) {
      setIsAuthenticated(true);
      setAuthEmail(savedEmail);
      pullFromCloud(savedEmail);
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: Conversation[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setConversations(parsed);
          const savedActiveId = localStorage.getItem(ACTIVE_CONV_KEY);
          if (savedActiveId && parsed.some((c) => c.id === savedActiveId)) {
            setActiveId(savedActiveId);
          } else {
            setActiveId(parsed[0].id);
          }
        }
      }

      const savedProfile = localStorage.getItem(PROFILE_KEY);
      if (savedProfile) {
        const p: UserProfile = JSON.parse(savedProfile);
        setUserProfile(p);
      }

      const savedNotes = localStorage.getItem(NOTES_KEY);
      if (savedNotes) setPersonalNotes(JSON.parse(savedNotes));

      const savedCommitments = localStorage.getItem(COMMITMENTS_KEY);
      if (savedCommitments) setCommitments(JSON.parse(savedCommitments));
    } catch (e) {
      console.error('Failed to load history:', e);
    }

    setConversations((prev) => {
      if (prev.length > 0) return prev;
      const initialId = 'conv_' + Date.now();
      const initialConv: Conversation = {
        id: initialId,
        title: 'Новый диалог',
        messages: [],
        updatedAt: Date.now(),
      };
      setActiveId(initialId);
      return [initialConv];
    });
  }, []);

  // 2. Persist state
  useEffect(() => {
    try {
      if (conversations.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
        if (authEmail) {
          if (skipNextAutoPushRef.current) {
            skipNextAutoPushRef.current = false;
            return;
          }
          pushToCloud(userProfile, conversations, commitments, personalNotes, authEmail).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Persist error:', err);
    }
  }, [conversations, authEmail]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(ACTIVE_CONV_KEY, activeId);
    }
  }, [activeId]);

  const currentConv = conversations.find((c) => c.id === activeId) || {
    id: activeId,
    title: 'Диалог',
    messages: [],
    updatedAt: Date.now(),
    timerSecondsLeft: 30 * 60,
    isTimerRunning: false,
  };

  const timerSecondsLeft = currentConv.timerSecondsLeft ?? 30 * 60;
  const isTimerRunning = currentConv.isTimerRunning ?? false;

  // Timer tick for active conversation only
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isTimerRunning && timerSecondsLeft > 0) {
      interval = setInterval(() => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  timerSecondsLeft: Math.max(0, (c.timerSecondsLeft ?? 30 * 60) - 1),
                }
              : c
          )
        );
      }, 1000);
    } else if (timerSecondsLeft === 0 && isTimerRunning) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, isTimerRunning: false } : c))
      );
      alert(
        lang === 'ru'
          ? '⏰ Время 30-минутной фокус-сессии истекло! Пора зафиксировать решения и действия.'
          : '⏰ 30-minute focus session completed! Time to commit to action.'
      );
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimerRunning, timerSecondsLeft, activeId, lang]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleTimer = () => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === activeId) {
          const currentlyRunning = c.isTimerRunning ?? false;
          let currentSecs = c.timerSecondsLeft ?? 30 * 60;
          if (!currentlyRunning && currentSecs === 0) {
            currentSecs = 30 * 60;
          }
          return {
            ...c,
            isTimerRunning: !currentlyRunning,
            timerSecondsLeft: currentSecs,
          };
        }
        return c;
      })
    );
  };

  const saveProfile = (updated: UserProfile) => {
    try {
      setUserProfile(updated);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
      pushToCloud(updated, conversations, commitments, personalNotes).catch(() => {});
    } catch (e) {
      console.warn('saveProfile error:', e);
    }
  };

  const saveNotes = (updated: PersonalNote[]) => {
    try {
      setPersonalNotes(updated);
      localStorage.setItem(NOTES_KEY, JSON.stringify(updated));
      pushToCloud(userProfile, conversations, commitments, updated).catch(() => {});
    } catch (e) {
      console.warn('saveNotes error:', e);
    }
  };

  const saveCommitments = (updated: Commitment[]) => {
    try {
      setCommitments(updated);
      localStorage.setItem(COMMITMENTS_KEY, JSON.stringify(updated));
      pushToCloud(userProfile, conversations, updated, personalNotes).catch(() => {});
    } catch (e) {
      console.warn('saveCommitments error:', e);
    }
  };

  const addCommitment = (text: string) => {
    if (!text.trim()) return;
    const newC: Commitment = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      text: text.trim(),
      date: new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US'),
      done: false,
    };
    saveCommitments([newC, ...commitments]);
    setNewCommitmentText('');
  };

  const toggleCommitment = (id: string) => {
    const updated = commitments.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
    saveCommitments(updated);
  };

  const deleteCommitment = (id: string) => {
    saveCommitments(commitments.filter((c) => c.id !== id));
  };

  // Open commitment selection modal for an assistant message
  const openCommitmentReview = (text: string) => {
    const items = extractActionItems(text);
    if (items.length === 0) {
      // Fallback: entire text or single task
      const fallbackText = text.replace(/^#+.*$/gm, '').trim().slice(0, 120);
      setProposedCommitments([{ id: 'prop_1', text: fallbackText, selected: true }]);
    } else {
      setProposedCommitments(
        items.map((item, idx) => ({
          id: `prop_${idx}_${Date.now()}`,
          text: item,
          selected: true, // selected by default, user has free will to uncheck
        }))
      );
    }
    setIsCommitSelectionModalOpen(true);
  };

  const confirmSelectedCommitments = () => {
    const chosen = proposedCommitments.filter((p) => p.selected && p.text.trim());
    if (chosen.length > 0) {
      const newItems: Commitment[] = chosen.map((c) => ({
        id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: c.text.trim(),
        date: new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US'),
        done: false,
      }));
      saveCommitments([...newItems, ...commitments]);
      setCelebratedCount(chosen.length);
      setIsCommitSelectionModalOpen(false);

      // Trigger Confetti Celebration 🎉
      try {
        // Multi-burst gold & celebratory colors
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#c9a84c', '#f59e0b', '#ffffff', '#eab308'],
        });
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#c9a84c', '#fbbf24', '#ffffff'],
          });
          confetti({
            particleCount: 50,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#c9a84c', '#fbbf24', '#ffffff'],
          });
        }, 250);
      } catch (e) {
        console.error('Confetti error:', e);
      }

      // Show Triumph Celebration Modal
      setIsCelebrationOpen(true);
    } else {
      setIsCommitSelectionModalOpen(false);
    }
  };

  const messages = currentConv.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  const handleCreateNewChat = () => {
    const newId = 'conv_' + Date.now();
    const newConv: Conversation = {
      id: newId,
      title: lang === 'ru' ? 'Новый диалог' : 'New Chat',
      messages: [],
      updatedAt: Date.now(),
      timerSecondsLeft: 30 * 60,
      isTimerRunning: false,
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newId);
    setIsSidebarOpen(false);
  };

  const handleDeleteChat = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = conversations.filter((c) => c.id !== idToDelete);
    if (filtered.length === 0) {
      const newId = 'conv_' + Date.now();
      const freshConv: Conversation = {
        id: newId,
        title: lang === 'ru' ? 'Новый диалог' : 'New Chat',
        messages: [],
        updatedAt: Date.now(),
      };
      setConversations([freshConv]);
      setActiveId(newId);
    } else {
      setConversations(filtered);
      if (activeId === idToDelete) {
        setActiveId(filtered[0].id);
      }
    }
  };

  const toggleVoice = () => {
    try {
      const SpeechRec: SpeechRecognitionConstructor | undefined =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        alert('Your browser does not support voice input. Try Chrome or Safari.');
        return;
      }

      if (isListening) {
        try {
          recognitionRef.current?.stop();
        } catch {
          // ignore
        }
        setIsListening(false);
        return;
      }

      const rec: ISpeechRecognition = new SpeechRec();
      rec.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
      rec.continuous = false;
      rec.interimResults = false;

      rec.onresult = (e: SpeechRecognitionEvent) => {
        try {
          const transcript = e.results[0][0].transcript;
          setInput((prev) => prev + (prev ? ' ' : '') + transcript);
        } catch {
          // ignore
        }
      };
      rec.onend = () => setIsListening(false);
      rec.onerror = (e) => {
        if (e && typeof (e as any).preventDefault === 'function') {
          try {
            (e as any).preventDefault();
          } catch {
            // ignore
          }
        }
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch (err) {
      console.warn('Voice input error:', err);
      setIsListening(false);
    }
  };

  const handleCopy = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const note: PersonalNote = {
          id: 'note_' + Date.now(),
          title: file.name,
          content: content.slice(0, 10000),
          createdAt: Date.now(),
        };
        saveNotes([note, ...personalNotes]);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddManualNote = () => {
    if (!newNoteTitle.trim() || !newNoteContent.trim()) return;
    const note: PersonalNote = {
      id: 'note_' + Date.now(),
      title: newNoteTitle.trim(),
      content: newNoteContent.trim(),
      createdAt: Date.now(),
    };
    saveNotes([note, ...personalNotes]);
    setNewNoteTitle('');
    setNewNoteContent('');
    setIsAddingNote(false);
  };

  const handleDeleteNote = (noteId: string) => {
    saveNotes(personalNotes.filter((n) => n.id !== noteId));
  };

  const sendCustomMessage = async (customText: string) => {
    if (isLoading) return;

    const userMsg: Message = { role: 'user', content: customText };
    const updatedMessages = [...messages, userMsg];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              messages: updatedMessages,
              updatedAt: Date.now(),
            }
          : c
      )
    );

    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          lang,
          userProfile,
          userNotes: personalNotes,
          userCommitments: commitments,
        }),
      });

      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      const botMsg: Message = { role: 'assistant', content: data.reply };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: [...updatedMessages, botMsg],
                updatedAt: Date.now(),
              }
            : c
        )
      );

      // Automatically offer to review commitments for summary
      setTimeout(() => {
        openCommitmentReview(data.reply);
      }, 600);
    } catch {
      const errorMsg: Message = {
        role: 'assistant',
        content:
          lang === 'ru'
            ? '⚠️ Произошла ошибка. Пожалуйста, попробуйте еще раз.'
            : '⚠️ An error occurred. Please try again.',
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: [...updatedMessages, errorMsg] }
            : c
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarizeSession = () => {
    if (messages.length === 0 || isLoading) return;

    // If summary was already done, ask if user wants to review or regenerate
    if (currentConv.isSummaryDone) {
      // Find the last assistant message with commitments
      const lastBotMsg = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastBotMsg) {
        openCommitmentReview(lastBotMsg.content);
        return;
      }
    }

    const confirmed = window.confirm(
      lang === 'ru'
        ? 'Завершить текущую сессию и подвести итог?'
        : 'Finalize this session and generate action commitments?'
    );

    if (!confirmed) return;

    // Mark summary as done for this conversation
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, isSummaryDone: true } : c))
    );

    const prompt =
      lang === 'ru'
        ? 'Питер, давай завершим эту сессию. Подведи четкий итог нашего разговора: выдели главное решение и сформулируй нумерованным списком ровно 2-3 моих конкретных шага-обязательства (начиная каждый пункт с 1., 2., 3.), которые я должен взять в работу!'
        : 'Peter, let us wrap up this session. Summarize our conversation: state the core breakthrough, and give me a numbered list of 2-3 immediate action commitments (starting each with 1., 2., 3.) to execute!';
    sendCustomMessage(prompt);
  };

  const sendMessage = async () => {
    try {
      const text = input.trim();
      if (!text || isLoading) return;

      const userMsg: Message = { role: 'user', content: text };
      const updatedMessages = [...messages, userMsg];

      const autoTitle =
        messages.length === 0
          ? text.slice(0, 30) + (text.length > 30 ? '...' : '')
          : currentConv.title;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                title: autoTitle,
                messages: updatedMessages,
                updatedAt: Date.now(),
              }
            : c
        )
      );

      setInput('');
      setIsLoading(true);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          lang,
          userProfile,
          userNotes: personalNotes,
          userCommitments: commitments,
        }),
      });

      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      const botMsg: Message = { role: 'assistant', content: data.reply };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: [...updatedMessages, botMsg],
                updatedAt: Date.now(),
              }
            : c
        )
      );
    } catch (err) {
      console.error('SendMessage error:', err);
      const errorMsg: Message = {
        role: 'assistant',
        content:
          lang === 'ru'
            ? '⚠️ Произошла ошибка. Пожалуйста, попробуйте еще раз.'
            : '⚠️ An error occurred. Please try again.',
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: [...c.messages, errorMsg] }
            : c
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeCommitmentsCount = commitments.filter((c) => !c.done).length;

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const email = authEmailInput.trim().toLowerCase();
    const password = authPasswordInput;

    if (!email || !email.includes('@')) {
      setAuthError(lang === 'ru' ? 'Введите корректный адрес электронной почты' : 'Enter valid email address');
      return;
    }

    if (!password || password.length < 6) {
      setAuthError(
        lang === 'ru' ? 'Пароль должен содержать минимум 6 символов' : 'Password must be at least 6 characters'
      );
      return;
    }

    setAuthLoading(true);

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: authNameInput.trim() }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setAuthError(data.error || (lang === 'ru' ? 'Ошибка авторизации' : 'Auth error'));
        setAuthLoading(false);
        return;
      }

      skipNextAutoPushRef.current = true;

      const studentName = authNameInput.trim();
      let activeProfile: UserProfile = { name: studentName, occupation: '', goals: '', challenges: '' };

      if (data.data?.profile && typeof data.data.profile === 'object') {
        activeProfile = { ...activeProfile, ...data.data.profile };
        if (!activeProfile.name && studentName) {
          activeProfile.name = studentName;
        }
      } else if (studentName) {
        activeProfile.name = studentName;
      }

      setUserProfile(activeProfile);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(activeProfile));

      setAuthEmail(email);
      setIsAuthenticated(true);
      localStorage.setItem(AUTH_EMAIL_KEY, email);

      if (data.data) {
        const { conversations: cloudConvs, commitments: cloudCommits, notes: cloudNotes } = data.data;

        if (Array.isArray(cloudConvs) && cloudConvs.length > 0) {
          setConversations(cloudConvs);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudConvs));
          setActiveId(cloudConvs[0].id);
        } else {
          const freshId = 'conv_' + Date.now();
          const freshConv: Conversation = {
            id: freshId,
            title: lang === 'ru' ? 'Новый диалог' : 'New Chat',
            messages: [],
            updatedAt: Date.now(),
            timerSecondsLeft: 30 * 60,
            isTimerRunning: false,
          };
          setConversations([freshConv]);
          localStorage.setItem(STORAGE_KEY, JSON.stringify([freshConv]));
          setActiveId(freshId);
        }

        const commits = Array.isArray(cloudCommits) ? cloudCommits : [];
        setCommitments(commits);
        localStorage.setItem(COMMITMENTS_KEY, JSON.stringify(commits));

        const notes = Array.isArray(cloudNotes) ? cloudNotes : [];
        setPersonalNotes(notes);
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      }

      if (authMode === 'register') {
        setWelcomeBanner(
          lang === 'ru'
            ? '🎉 Регистрация успешна! Письмо с подтверждением и паролем отправлено на вашу почту.'
            : '🎉 Registration complete! Confirmation email sent.'
        );
        setTimeout(() => setWelcomeBanner(''), 7000);
      }
    } catch (err: any) {
      setAuthError(err.message || (lang === 'ru' ? 'Ошибка соединения' : 'Network error'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    const confirmed = window.confirm(
      lang === 'ru' ? 'Вы действительно хотите выйти из своего аккаунта?' : 'Do you want to log out?'
    );
    if (!confirmed) return;
    localStorage.removeItem(AUTH_EMAIL_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(NOTES_KEY);
    localStorage.removeItem(COMMITMENTS_KEY);
    localStorage.removeItem(ACTIVE_CONV_KEY);

    setIsAuthenticated(false);
    setAuthEmail('');
    setAuthNameInput('');
    setAuthEmailInput('');
    setAuthPasswordInput('');
    setAuthError('');
    setIsProfileModalOpen(false);

    setConversations([]);
    setUserProfile({ name: '', occupation: '', goals: '', challenges: '' });
    setCommitments([]);
    setPersonalNotes([]);
    setActiveId('');
  };

  // Lock Screen if not authenticated (Email + Password Login / Register)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: 'var(--background)' }}>
        {/* Top-right quick controls: Theme & Language */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {/* Theme switch */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl font-medium transition-all shadow-sm"
            style={{
              background: 'var(--surface)',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
            }}
            title={lang === 'ru' ? (theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему') : (theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme')}
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span className="text-[11px] font-semibold">{theme === 'dark' ? (lang === 'ru' ? 'Светлая' : 'Light') : (lang === 'ru' ? 'Тёмная' : 'Dark')}</span>
          </button>

          {/* Lang switch */}
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'ru' ? 'en' : 'ru'))}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-xl transition-all shadow-sm"
            style={{
              background: 'var(--surface)',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
            }}
            title={lang === 'ru' ? 'Сменить язык' : 'Switch language'}
          >
            {lang === 'ru' ? '🇷🇺 RU' : '🇺🇸 EN'}
          </button>
        </div>

        <div
          className="w-full max-w-sm rounded-3xl p-8 text-center space-y-6 shadow-2xl border"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          {/* Logo */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-bold mx-auto shadow-lg"
            style={{ background: 'var(--accent)', color: '#000' }}
          >
            P
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>
              Peter Daniels AI
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {lang === 'ru' ? 'Персональный виртуальный наставник' : 'Personal AI Mentor'}
            </p>
          </div>

          {/* Mode Switcher */}
          <div
            className="flex rounded-xl p-1 text-xs font-semibold"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
              className="flex-1 py-2 rounded-lg transition-all"
              style={
                authMode === 'login'
                  ? {
                      background: 'var(--surface)',
                      color: 'var(--accent)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }
                  : {
                      color: 'var(--text-muted)',
                    }
              }
            >
              {lang === 'ru' ? 'Вход' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
              }}
              className="flex-1 py-2 rounded-lg transition-all"
              style={
                authMode === 'register'
                  ? {
                      background: 'var(--surface)',
                      color: 'var(--accent)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }
                  : {
                      color: 'var(--text-muted)',
                    }
              }
            >
              {lang === 'ru' ? 'Регистрация' : 'Register'}
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-3.5 text-left">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                  {lang === 'ru' ? 'Ваше имя (как к вам обращаться)' : 'Your Name'}
                </label>
                <input
                  type="text"
                  value={authNameInput}
                  onChange={(e) => setAuthNameInput(e.target.value)}
                  placeholder={lang === 'ru' ? 'Например: Владимир' : 'E.g. Vladimir'}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                Email
              </label>
              <input
                type="email"
                required
                autoFocus
                value={authEmailInput}
                onChange={(e) => {
                  setAuthEmailInput(e.target.value);
                  setAuthError('');
                }}
                placeholder="vladimir@example.com"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                {lang === 'ru' ? 'Пароль' : 'Password'}
              </label>
              <input
                type="password"
                required
                value={authPasswordInput}
                onChange={(e) => {
                  setAuthPasswordInput(e.target.value);
                  setAuthError('');
                }}
                placeholder={lang === 'ru' ? 'Минимум 6 символов' : 'Min 6 chars'}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>

            {authMode === 'register' && (
              <p className="text-[11px] leading-relaxed pt-1" style={{ color: 'var(--accent)' }}>
                ✉️ {lang === 'ru' 
                  ? 'Мы вышлем подтверждение и ваши данные для входа на эту почту.' 
                  : 'We will send a welcome email with your login details.'}
              </p>
            )}

            {authError && (
              <div
                className="p-2.5 rounded-xl text-xs"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                }}
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md mt-2 flex items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: '#000',
              }}
            >
              {authLoading ? (
                <span>{lang === 'ru' ? 'Секунду...' : 'Please wait...'}</span>
              ) : authMode === 'login' ? (
                <span>{lang === 'ru' ? 'Войти в систему' : 'Sign In'}</span>
              ) : (
                <span>{lang === 'ru' ? 'Зарегистрироваться' : 'Create Account'}</span>
              )}
            </button>
          </form>

          {/* Toggle */}
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
              }}
              className="text-xs transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              {authMode === 'login'
                ? (lang === 'ru' ? 'Впервые здесь? Создать аккаунт →' : 'New here? Register →')
                : (lang === 'ru' ? 'Уже есть аккаунт? Войти →' : 'Already registered? Sign in →')}
            </button>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {lang === 'ru' ? 'Синхронизация между устройствами подключена' : 'Cross-device sync enabled'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 flex flex-col transition-transform duration-300 md:static md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Sidebar Header */}
        <div className="p-3.5 border-b space-y-2.5" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNewChat}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-medium text-sm transition-all shadow-sm"
              style={{
                background: 'var(--accent)',
                color: '#000',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {lang === 'ru' ? 'Новый диалог' : 'New Chat'}
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-2 rounded-lg"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>

          {/* Profile & Memory Button */}
          <button
            onClick={() => setIsProfileModalOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">🎯</span>
              <div className="text-left">
                <div className="font-semibold" style={{ color: 'var(--accent)' }}>
                  {userProfile.name ? userProfile.name : (lang === 'ru' ? 'Мой профиль и цели' : 'My Profile & Goals')}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {activeCommitmentsCount > 0
                    ? `⚠️ ${activeCommitmentsCount} ${lang === 'ru' ? 'активных обязательств' : 'active tasks'}`
                    : (lang === 'ru' ? 'Память и обязательства' : 'Memory & Commitments')}
                </div>
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Action Items Mini Widget in Sidebar */}
        {commitments.length > 0 && (
          <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase px-1" style={{ color: 'var(--accent)' }}>
              <span>{lang === 'ru' ? 'Мои обязательства' : 'Action Commitments'}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {commitments.filter((c) => c.done).length}/{commitments.length}
              </span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {commitments.slice(0, 4).map((c) => (
                <div
                  key={c.id}
                  onClick={() => toggleCommitment(c.id)}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer border transition-colors ${
                    c.done ? 'line-through' : ''
                  }`}
                  style={
                    c.done
                      ? {
                          background: 'var(--surface-2)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-muted)',
                        }
                      : {
                          background: 'var(--surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--foreground)',
                        }
                  }
                  title={c.done ? (lang === 'ru' ? 'Нажмите, чтобы вернуть в работу' : 'Click to resume') : (lang === 'ru' ? 'Нажмите, чтобы отметить выполненным' : 'Click to mark complete')}
                >
                  <span className="truncate pr-2 leading-tight">{c.text.replace(/\*+/g, '').trim()}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={
                      c.done
                        ? { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }
                        : { background: 'var(--card-highlight)', color: 'var(--accent)' }
                    }
                  >
                    {c.done ? '✓' : (lang === 'ru' ? 'В работе' : 'In work')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs uppercase font-semibold px-2 mb-2 tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {lang === 'ru' ? 'История диалогов' : 'Conversations'}
          </div>

          {conversations.map((c) => {
            const isActive = c.id === activeId;
            return (
              <div
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  setIsSidebarOpen(false);
                }}
                className="group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-sm transition-colors"
                style={
                  isActive
                    ? {
                        background: 'var(--surface-2)',
                        color: 'var(--accent)',
                        border: '1px solid var(--border)',
                        fontWeight: 600,
                      }
                    : {
                        color: 'var(--foreground)',
                      }
                }
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 opacity-70">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="truncate">
                    {(!c.title || c.title === 'Новый диалог' || c.title === 'New chat')
                      ? (lang === 'ru' ? 'Новый диалог' : 'New chat')
                      : c.title}
                  </span>
                </div>

                <button
                  onClick={(e) => handleDeleteChat(c.id, e)}
                  title={lang === 'ru' ? 'Удалить' : 'Delete'}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1 rounded transition-opacity"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <header
          className="flex items-center justify-between px-3 md:px-6 py-3 border-b gap-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg"
              style={{ color: 'var(--foreground)' }}
              title={lang === 'ru' ? 'Открыть меню' : 'Open menu'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0 shadow"
              style={{ background: 'var(--accent)', color: '#000' }}
            >
              P
            </div>
            <div className="truncate">
              <h1 className="font-bold text-sm md:text-base leading-tight truncate" style={{ color: 'var(--accent)' }}>
                Peter Daniels
              </h1>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <span>{lang === 'ru' ? 'Виртуальный наставник' : 'Virtual Mentor'}</span>
                {userProfile.name ? (
                  <span style={{ color: 'var(--accent)' }}>· {userProfile.name}</span>
                ) : null}
                <span
                  title={
                    syncStatus === 'synced'
                      ? (lang === 'ru' ? `Синхронизировано (${authEmail}) · Нажмите для обновления` : `Synced (${authEmail}) · Click to refresh`)
                      : syncStatus === 'syncing'
                      ? (lang === 'ru' ? 'Синхронизация...' : 'Syncing...')
                      : (lang === 'ru' ? 'Офлайн (локальное сохранение)' : 'Offline (saved locally)')
                  }
                  className="cursor-pointer"
                  onClick={() => authEmail && pullFromCloud(authEmail)}
                >
                  {syncStatus === 'synced' && '☁️'}
                  {syncStatus === 'syncing' && '🔄'}
                  {syncStatus === 'offline' && '⚠️'}
                </span>
              </div>
            </div>
          </div>

          {/* Action Tools Header */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            {/* Session Timer Widget */}
            <button
              onClick={toggleTimer}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-all ${
                isTimerRunning ? 'animate-pulse' : ''
              }`}
              style={
                isTimerRunning
                  ? {
                      background: 'var(--card-highlight)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)',
                    }
                  : {
                      background: 'var(--surface-2)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }
              }
              title={isTimerRunning ? (lang === 'ru' ? 'Поставить таймер на паузу' : 'Pause timer') : (lang === 'ru' ? 'Запустить 30-минутную фокус-сессию' : 'Start 30-minute focus session')}
            >
              <span>⏱️</span>
              <span className="font-mono text-[11px]">{formatTimer(timerSecondsLeft)}</span>
            </button>

            {/* Summarize & Commit Button */}
            {messages.length > 0 && (
              <button
                onClick={handleSummarizeSession}
                disabled={isLoading}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--accent)',
                  border: '1px solid var(--border)',
                }}
              >
                <span>{currentConv.isSummaryDone ? '🎯' : '🏁'}</span>
                <span className="hidden sm:inline">
                  {currentConv.isSummaryDone
                    ? (lang === 'ru' ? 'Выбрать обязательства' : 'Select Commitments')
                    : (lang === 'ru' ? 'Итог и план' : 'Action Plan')}
                </span>
              </button>
            )}

            {/* Quick Profile Open Button */}
            <button
              onClick={() => setIsProfileModalOpen(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'var(--surface-2)',
                color: userProfile.name ? 'var(--accent)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              title={lang === 'ru' ? 'Мой профиль и цели' : 'My profile and goals'}
            >
              <span>🎯</span>
              <span className="hidden lg:inline">
                {userProfile.name ? userProfile.name : (lang === 'ru' ? 'Мои цели' : 'My Goals')}
              </span>
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--accent)',
                border: '1px solid var(--border)',
              }}
              title={lang === 'ru' ? (theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему') : (theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme')}
            >
              <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
              <span className="hidden sm:inline">
                {theme === 'dark' ? (lang === 'ru' ? 'Светлая' : 'Light') : (lang === 'ru' ? 'Тёмная' : 'Dark')}
              </span>
            </button>

            {/* Language toggle */}
            <button
              onClick={() => setLang((l) => (l === 'ru' ? 'en' : 'ru'))}
              className="text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--accent)',
                border: '1px solid var(--border)',
              }}
              title={lang === 'ru' ? 'Переключить язык' : 'Switch language'}
            >
              {lang === 'ru' ? '🇷🇺 RU' : '🇺🇸 EN'}
            </button>
          </div>
        </header>

        {/* Welcome Registration Banner */}
        {welcomeBanner && (
          <div
            className="border-b text-xs px-4 py-2.5 flex items-center justify-between shadow-sm"
            style={{
              background: 'var(--surface-2)',
              borderBottomColor: 'var(--accent)',
              color: 'var(--foreground)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">✉️</span>
              <span>{welcomeBanner}</span>
            </div>
            <button
              onClick={() => setWelcomeBanner('')}
              className="px-2 py-0.5 rounded text-sm font-bold"
              style={{ color: 'var(--accent)' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Welcome message when empty */}
            {messages.length === 0 && (
              <div className="text-center py-10 md:py-14">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4 shadow-lg"
                  style={{ background: 'var(--surface-2)', color: 'var(--accent)', border: '1px solid var(--border)' }}
                >
                  P
                </div>
                <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: 'var(--accent)' }}>
                  {userProfile.name
                    ? (lang === 'ru' ? `Я слушаю тебя, ${userProfile.name}` : `I am listening, ${userProfile.name}`)
                    : (lang === 'ru' ? 'Я слушаю тебя, мой друг' : 'I am listening, my friend')}
                </h2>

                {activeCommitmentsCount > 0 && (
                  <div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-3"
                    style={{
                      background: 'var(--card-highlight)',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                    }}
                  >
                    <span>⚠️</span>
                    <span>
                      {lang === 'ru'
                        ? `У тебя есть ${activeCommitmentsCount} невыполненных обязательств с прошлой беседы`
                        : `You have ${activeCommitmentsCount} active commitments from previous talks`}
                    </span>
                  </div>
                )}

                <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
                  {lang === 'ru'
                    ? 'Задай вопрос о бизнесе, формуле успеха, жизненной цели или преодолении кризиса — я поделюсь принципами из своего жизненного пути.'
                    : "Ask me about business, success formula, life purpose, or overcoming crisis — I will share principles from my journey."}
                </p>

                {/* Suggested questions */}
                <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl mx-auto">
                  {(activeCommitmentsCount > 0
                    ? lang === 'ru'
                      ? [
                          'Питер, давай разберем мои прошлые обязательства и отчет',
                          'Как преодолеть страх неудачи при старте?',
                          'В чем суть концепции "Судьба 3-го тысячелетия"?',
                          'Как научиться доводить начатые проекты до победы?',
                        ]
                      : [
                          "Peter, let's review my previous commitments and progress",
                          'How do I conquer the fear of failure when starting?',
                          'What is the essence of Destiny of the 3rd Millennium?',
                          'How do I build the discipline to finish what I start?',
                        ]
                    : lang === 'ru'
                    ? [
                        'Как преодолеть страх неудачи?',
                        'В чем суть концепции "Судьба 3-го тысячелетия"?',
                        'Как ты вылез из трех банкротств подряд?',
                        'Как научиться доводить начатые проекты до победы?',
                      ]
                    : [
                        'How do I conquer the fear of failure?',
                        'What is the essence of Destiny of the 3rd Millennium?',
                        'How did you recover from three consecutive bankruptcies?',
                        'How do I build the discipline to finish what I start?',
                      ]
                  ).map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="text-xs md:text-sm text-left px-3.5 py-2.5 rounded-xl transition-all"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--foreground)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1 shadow"
                    style={{ background: 'var(--accent)', color: '#000' }}
                  >
                    P
                  </div>
                )}

                <div
                  className={`relative group max-w-2xl px-4 py-3 rounded-2xl ${
                    msg.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'
                  }`}
                  style={
                    msg.role === 'user'
                      ? {
                          background: 'var(--bubble-user-bg)',
                          color: 'var(--bubble-user-text)',
                          border: '1px solid var(--border)',
                        }
                      : {
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--foreground)',
                        }
                  }
                >
                  {msg.role === 'assistant' ? (
                    <div>
                      <div className="prose-peter text-sm leading-relaxed pb-3">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>

                      {/* Message Actions */}
                      <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                        {hasActionCommitments(msg.content, i, messages) ? (
                          <button
                            onClick={() => openCommitmentReview(msg.content)}
                            className="pulse-gold-btn text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-md"
                            style={{
                              background: 'var(--accent)',
                              color: '#000000',
                              border: '1px solid rgba(255, 255, 255, 0.25)',
                            }}
                            title={lang === 'ru' ? 'Выбрать шаги и принять на себя обязательства' : 'Choose action steps and accept commitments'}
                          >
                            <span className="text-sm">🎯</span>
                            <span className="font-bold">{lang === 'ru' ? 'Взять на себя обязательства' : 'Accept Commitments'}</span>
                          </button>
                        ) : (
                          <div />
                        )}

                        <button
                          onClick={() => handleCopy(msg.content, i)}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors"
                          style={{
                            background: 'var(--surface-2)',
                            color: copiedIndex === i ? 'var(--accent)' : 'var(--text-muted)',
                            border: '1px solid var(--border)',
                          }}
                          title={lang === 'ru' ? 'Скопировать ответ' : 'Copy response'}
                        >
                          {copiedIndex === i ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>{lang === 'ru' ? 'Скопировано!' : 'Copied!'}</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                              <span>{lang === 'ru' ? 'Скопировать' : 'Copy'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'var(--accent)', color: '#000' }}
                >
                  P
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ru' ? 'Питер размышляет...' : 'Peter is reflecting...'}
                  </span>
                  <div className="flex gap-1 items-center h-4">
                    {[0, 1, 2].map((dot) => (
                      <div
                        key={dot}
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{
                          background: 'var(--accent)',
                          animationDelay: `${dot * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* Input area */}
        <footer
          className="px-4 py-3.5 border-t"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="max-w-3xl mx-auto">
            <div
              className="flex items-end gap-2 rounded-2xl px-3 py-2"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {/* Voice button */}
              <button
                onClick={toggleVoice}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                style={{
                  background: isListening ? 'var(--accent)' : 'transparent',
                  color: isListening ? '#000' : 'var(--text-muted)',
                }}
                title={
                  isListening
                    ? (lang === 'ru' ? 'Остановить ввод' : 'Stop voice input')
                    : (lang === 'ru' ? 'Голосовой ввод' : 'Voice input')
                }
              >
                {isListening ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1a11 11 0 100 22A11 11 0 0012 1zm0 20a9 9 0 110-18 9 9 0 010 18z" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  lang === 'ru'
                    ? isListening
                      ? '🎤 Говорите...'
                      : 'Задайте вопрос Питеру Дэниелсу...'
                    : isListening
                    ? '🎤 Listening...'
                    : 'Ask Peter Daniels a question...'
                }
                rows={1}
                className="flex-1 bg-transparent outline-none resize-none text-sm py-1 leading-normal"
                style={{ color: 'var(--foreground)', maxHeight: '140px' }}
              />

              {/* Send button */}
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                style={{
                  background: input.trim() && !isLoading ? 'var(--accent)' : 'transparent',
                  color: input.trim() && !isLoading ? '#000' : 'var(--text-muted)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              </button>
            </div>

            <p className="text-center text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {lang === 'ru'
                ? 'Enter — отправить · Shift+Enter — новая строка · 🎤 — голосовой ввод · 🏁 — итог и план'
                : 'Enter to send · Shift+Enter for new line · 🎤 for voice · 🏁 summarize session'}
            </p>
          </div>
        </footer>
      </div>

      {/* MODAL 1: Commitment Decision & Free Will Selection */}
      {isCommitSelectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md" style={{ background: 'var(--modal-overlay)' }}>
          <div
            className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl border"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {/* Header: Centered Title */}
            <div className="relative p-4 border-b flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">🤝</span>
                <h3 className="font-bold text-base md:text-lg text-center" style={{ color: 'var(--accent)' }}>
                  {lang === 'ru' ? 'Выбор обязательств ученика' : 'Accept Commitments'}
                </h3>
              </div>
              <button
                onClick={() => setIsCommitSelectionModalOpen(false)}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title={lang === 'ru' ? 'Закрыть' : 'Close'}
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {lang === 'ru'
                  ? 'Питер Дэниелс предложил следующие шаги. Отметьте только те, которые вы осознанно готовы взять в работу. Питер спросит с вас отчет по ним!'
                  : 'Peter Daniels proposed the following steps. Select only those you deliberately commit to execute.'}
              </p>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {proposedCommitments.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setProposedCommitments((prev) =>
                        prev.map((p) => (p.id === item.id ? { ...p, selected: !p.selected } : p))
                      );
                    }}
                    className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all"
                    style={
                      item.selected
                        ? {
                            background: 'var(--card-highlight)',
                            borderColor: 'var(--accent)',
                            color: 'var(--foreground)',
                          }
                        : {
                            background: 'var(--surface-2)',
                            borderColor: 'var(--border)',
                            color: 'var(--text-muted)',
                            opacity: 0.75,
                          }
                    }
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => {}}
                      className="mt-0.5 rounded accent-amber-500 cursor-pointer h-4 w-4"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                        {lang === 'ru' ? `Обязательство #${idx + 1}` : `Commitment #${idx + 1}`}
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--foreground)' }}>
                        {item.text.replace(/\*+/g, '').trim()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setIsCommitSelectionModalOpen(false)}
                className="text-xs px-3 py-1.5 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                {lang === 'ru' ? 'Отклонить всё' : 'Cancel'}
              </button>

              <button
                onClick={confirmSelectedCommitments}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md"
                style={{ background: 'var(--accent)', color: '#000' }}
              >
                {lang === 'ru'
                  ? `Принять выбранные (${proposedCommitments.filter((p) => p.selected).length})`
                  : `Commit Selected (${proposedCommitments.filter((p) => p.selected).length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 0: Celebration & Triumph Modal 🎉 */}
      {isCelebrationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in" style={{ background: 'var(--modal-overlay)' }}>
          <div
            className="w-full max-w-md rounded-3xl p-6 text-center shadow-2xl border space-y-4"
            style={{
              background:
                theme === 'dark'
                  ? 'linear-gradient(145deg, #1f1b14 0%, #12110e 100%)'
                  : 'linear-gradient(145deg, #ffffff 0%, #f7f4ec 100%)',
              borderColor: 'var(--accent)',
            }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner"
              style={{
                background: 'var(--card-highlight)',
                border: '1px solid var(--accent)',
              }}
            >
              🏆
            </div>

            <div className="space-y-1.5">
              <h3 className="font-extrabold text-lg md:text-xl" style={{ color: 'var(--accent)' }}>
                {lang === 'ru'
                  ? `Обязательства приняты, ${userProfile.name || 'мой друг'}!`
                  : `Commitment Made, ${userProfile.name || 'my friend'}!`
                }
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {lang === 'ru'
                  ? `Вы зафиксировали ${celebratedCount} ${
                      celebratedCount === 1
                        ? 'конкретный шаг'
                        : celebratedCount >= 2 && celebratedCount <= 4
                        ? 'конкретных шага'
                        : 'конкретных шагов'
                    } к исполнению.`
                  : `You committed to ${celebratedCount} decisive action ${
                      celebratedCount === 1 ? 'step' : 'steps'
                    }.`}
              </p>
            </div>

            <div
              className="p-3.5 rounded-2xl border text-left"
              style={{
                background: 'var(--surface-2)',
                borderColor: 'var(--border)',
              }}
            >
              <p className="text-xs italic leading-relaxed" style={{ color: 'var(--foreground)' }}>
                {lang === 'ru'
                  ? '«Слова стоят дёшево. Но готовность действовать и держать слово разделяет лидеров и мечтателей. Я горжусь твоим выбором. Иди и победи!»'
                  : '«Words are cheap. But execution separates leaders from dreamers. I am proud of your resolve. Go and win!»'}
              </p>
              <div className="text-right text-[11px] font-semibold mt-2" style={{ color: 'var(--accent)' }}>
                — Peter Daniels
              </div>
            </div>

            <button
              onClick={() => setIsCelebrationOpen(false)}
              className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg"
              style={{
                background: 'var(--accent)',
                color: '#000',
              }}
            >
              {lang === 'ru' ? 'Вперёд, к победе! 🚀' : 'Forward to Victory! 🚀'}
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: My Profile, Goals & Action Commitments */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'var(--modal-overlay)' }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">🎯</span>
                <h3 className="font-bold text-base" style={{ color: 'var(--accent)' }}>
                  {lang === 'ru' ? 'Мой профиль, цели и обязательства' : 'My Profile, Goals & Commitments'}
                </h3>
              </div>
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="p-1 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
              {/* Section 1: Action Commitments */}
              <div className="space-y-3 p-4 rounded-xl border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                    <span>📌</span>
                    <span>{lang === 'ru' ? 'Мои обязательства к исполнению' : 'Action Commitments'}</span>
                  </h4>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {commitments.filter((c) => !c.done).length} {lang === 'ru' ? 'в процессе' : 'pending'}
                  </span>
                </div>

                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {lang === 'ru'
                    ? 'Питер Дэниелс спросит с вас отчет по этим пунктам в начале следующего разговора.'
                    : 'Peter Daniels will ask for your progress on these tasks at the start of your next talk.'}
                </p>

                {/* Add new commitment input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCommitmentText}
                    onChange={(e) => setNewCommitmentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCommitment(newCommitmentText);
                      }
                    }}
                    placeholder={lang === 'ru' ? 'Добавить новое обязательство/шаг...' : 'Add new action commitment...'}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                  <button
                    onClick={() => addCommitment(newCommitmentText)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: 'var(--accent)', color: '#000' }}
                  >
                    +
                  </button>
                </div>

                {/* Commitments list */}
                {commitments.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 pt-1">
                    {commitments.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-start justify-between p-3 rounded-xl border transition-all"
                        style={
                          c.done
                            ? {
                                background: 'var(--surface-2)',
                                borderColor: 'var(--border)',
                                opacity: 0.75,
                              }
                            : {
                                background: 'var(--surface)',
                                borderColor: 'var(--border)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                              }
                        }
                      >
                        <div className="flex-1 pr-3 space-y-1">
                          <p
                            className={`text-xs leading-relaxed ${c.done ? 'line-through' : 'font-medium'}`}
                            style={{ color: c.done ? 'var(--text-muted)' : 'var(--foreground)' }}
                          >
                            {c.text.replace(/\*+/g, '').trim()}
                          </p>
                          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {lang === 'ru' ? 'Добавлено' : 'Added'}: {c.date}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => toggleCommitment(c.id)}
                            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                            style={
                              c.done
                                ? {
                                    background: 'rgba(16, 185, 129, 0.15)',
                                    color: '#10b981',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                  }
                                : {
                                    background: 'var(--card-highlight)',
                                    color: 'var(--accent)',
                                    border: '1px solid var(--accent)',
                                  }
                            }
                            title={lang === 'ru' ? 'Нажмите, чтобы переключить статус задачи' : 'Click to toggle task status'}
                          >
                            <span>{c.done ? (lang === 'ru' ? '✅ Сделано' : '✅ Done') : (lang === 'ru' ? '⏳ В процессе' : '⏳ In progress')}</span>
                          </button>

                          <button
                            onClick={() => deleteCommitment(c.id)}
                            className="hover:text-red-400 p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title={lang === 'ru' ? 'Удалить задачу' : 'Delete task'}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-3 text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ru' ? 'Нет активных обязательств. Обсудите планы с Питером!' : 'No active commitments'}
                  </div>
                )}
              </div>

              {/* Section 2: Student Profile */}
              <div className="space-y-4">
                <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                  {lang === 'ru' ? 'Карточка ученика' : 'Student Profile'}
                </h4>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {lang === 'ru' ? 'Ваше имя / Как к вам обращаться' : 'Your Name'}
                  </label>
                  <input
                    type="text"
                    value={userProfile.name}
                    onChange={(e) => saveProfile({ ...userProfile, name: e.target.value })}
                    placeholder={lang === 'ru' ? 'Например: Владимир' : 'e.g. John'}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {lang === 'ru' ? 'Сфера деятельности / Бизнес' : 'Business / Occupation'}
                  </label>
                  <input
                    type="text"
                    value={userProfile.occupation}
                    onChange={(e) => saveProfile({ ...userProfile, occupation: e.target.value })}
                    placeholder={lang === 'ru' ? 'Например: Предприниматель, IT-проекты, девелопмент...' : 'e.g. Entrepreneur, IT projects, real estate...'}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {lang === 'ru' ? 'Главные цели (жизненные, финансовые, бизнес)' : 'Main Life & Business Goals'}
                  </label>
                  <textarea
                    rows={3}
                    value={userProfile.goals}
                    onChange={(e) => saveProfile({ ...userProfile, goals: e.target.value })}
                    placeholder={lang === 'ru' ? 'Например: Выйти на оборот..., запустить благотворительный фонд, освоить новые рынки...' : 'e.g. Scale revenue to..., launch a charity foundation, expand into new markets...'}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {lang === 'ru' ? 'Текущие вызовы / Фокус внимания' : 'Current Challenges / Focus'}
                  </label>
                  <textarea
                    rows={2}
                    value={userProfile.challenges}
                    onChange={(e) => saveProfile({ ...userProfile, challenges: e.target.value })}
                    placeholder={lang === 'ru' ? 'Например: Нехватка времени, дисциплина, подбор сильных партнеров...' : 'e.g. Time management, discipline, finding strong partners...'}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                </div>
              </div>

              {/* Section 3: Personal Notes / Documents */}
              <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                      {lang === 'ru' ? 'Личные документы и заметки' : 'Personal Documents & Notes'}
                    </h4>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {lang === 'ru' ? 'Файлы планов (.txt, .md) для анализа наставником' : 'Plan files (.txt, .md)'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.text"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                    >
                      <span>📎</span>
                      <span>{lang === 'ru' ? 'Загрузить файл' : 'Upload File'}</span>
                    </button>

                    <button
                      onClick={() => setIsAddingNote(true)}
                      className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      style={{ background: 'var(--accent)', color: '#000' }}
                    >
                      <span>+</span>
                      <span>{lang === 'ru' ? 'Добавить' : 'Add'}</span>
                    </button>
                  </div>
                </div>

                {/* Form to add note manually */}
                {isAddingNote && (
                  <div className="p-3 rounded-xl space-y-2 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <input
                      type="text"
                      value={newNoteTitle}
                      onChange={(e) => setNewNoteTitle(e.target.value)}
                      placeholder={lang === 'ru' ? 'Название (например: Стратегия на 2026 год)' : 'Title (e.g. Strategy 2026)'}
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                    />
                    <textarea
                      rows={3}
                      value={newNoteContent}
                      onChange={(e) => setNewNoteContent(e.target.value)}
                      placeholder={lang === 'ru' ? 'Содержание заметки или ключевые пункты...' : 'Note content or key principles...'}
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none resize-none"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setIsAddingNote(false)}
                        className="text-xs px-3 py-1 rounded-lg"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {lang === 'ru' ? 'Отмена' : 'Cancel'}
                      </button>
                      <button
                        onClick={handleAddManualNote}
                        className="text-xs px-3 py-1 rounded-lg font-medium"
                        style={{ background: 'var(--accent)', color: '#000' }}
                      >
                        {lang === 'ru' ? 'Сохранить в память' : 'Save to memory'}
                      </button>
                    </div>
                  </div>
                )}

                {/* List of uploaded notes */}
                {personalNotes.length === 0 ? (
                  <div className="text-center py-2 text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ru' ? 'Пока нет прикрепленных документов' : 'No documents attached yet'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {personalNotes.map((note) => (
                      <div
                        key={note.id}
                        className="flex items-start justify-between p-3 rounded-xl border text-xs"
                        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
                      >
                        <div className="space-y-1 pr-3 max-w-[85%]">
                          <div className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--foreground)' }}>
                            <span>📄</span>
                            <span>{note.title}</span>
                          </div>
                          <p className="text-[11px] line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                            {note.content}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="hover:text-red-400 p-1"
                          style={{ color: 'var(--text-muted)' }}
                          title={lang === 'ru' ? 'Удалить' : 'Delete'}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 4: Account & Multi-Device Cloud Sync */}
              <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                    <span>☁️</span>
                    <span>{lang === 'ru' ? 'Аккаунт и синхронизация' : 'Account & Sync'}</span>
                  </h4>
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background:
                        syncStatus === 'synced'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : syncStatus === 'syncing'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                      color:
                        syncStatus === 'synced'
                          ? '#10b981'
                          : syncStatus === 'syncing'
                          ? '#f59e0b'
                          : '#ef4444',
                      border:
                        syncStatus === 'synced'
                          ? '1px solid rgba(16, 185, 129, 0.3)'
                          : syncStatus === 'syncing'
                          ? '1px solid rgba(245, 158, 11, 0.3)'
                          : '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    {syncStatus === 'synced'
                      ? (lang === 'ru' ? 'Подключено к облаку' : 'Synced')
                      : syncStatus === 'syncing'
                      ? (lang === 'ru' ? 'Синхронизация...' : 'Syncing...')
                      : (lang === 'ru' ? 'Офлайн' : 'Offline')}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border space-y-3" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {lang === 'ru' ? 'Вы вошли как:' : 'Signed in as:'}
                      </div>
                      <div className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                        {authEmail || '—'}
                      </div>
                    </div>

                    <button
                      onClick={handleLogout}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 border border-red-500/30 transition-colors"
                    >
                      {lang === 'ru' ? 'Выйти из аккаунта' : 'Sign Out'}
                    </button>
                  </div>

                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ru'
                      ? 'Все ваши диалоги, карточка ученика и обязательства привязаны к вашему Email и автоматически синхронизируются на телефоне и компьютере.'
                      : 'All your history and commitments are linked to this email and synced across all your devices.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{ background: 'var(--accent)', color: '#000' }}
              >
                {lang === 'ru' ? 'Готово / Закрыть' : 'Done / Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
