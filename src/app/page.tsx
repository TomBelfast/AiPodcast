'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialogueInput } from '@/types';

// LocalStorage helpers
const STORAGE_KEYS = {
  SETTINGS: 'ai-podcast-settings',
  HISTORY: 'ai-podcast-history',
};

interface Settings {
  language: string;
  selectedVoice1: string;
  selectedVoice2: string;
  autoGenerateAudio: boolean;
  url: string;
  useTranscript: boolean;
}

interface HistoryItem {
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  size?: number;
  audioBase64?: string; // Store small preview or metadata only
  conversation?: Array<{ speaker: string; text: string }>;
}

const loadSettings = (): Partial<Settings> => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error loading settings:', error);
    return {};
  }
};

const saveSettings = (settings: Partial<Settings>) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

const loadHistory = (): HistoryItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading history:', error);
    return [];
  }
};

const saveHistory = (history: HistoryItem[]) => {
  if (typeof window === 'undefined') return;
  try {
    // Limit history to last 50 items to avoid localStorage size issues
    const limitedHistory = history.slice(-50);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(limitedHistory));
  } catch (error) {
    console.error('Error saving history:', error);
    // If storage is full, try to save without audio data
    try {
      const historyWithoutAudio = history.slice(-50).map(item => ({
        ...item,
        audioBase64: undefined, // Remove audio data to save space
      }));
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(historyWithoutAudio));
    } catch (e) {
      console.error('Error saving history without audio:', e);
    }
  }
};

const addToHistory = (item: HistoryItem) => {
  const history = loadHistory();
  history.unshift(item); // Add to beginning
  saveHistory(history);
};

export default function Home() {
  // Load settings from localStorage
  const savedSettings = loadSettings();
  
  // Default URL per request
  const [url, setUrl] = useState(savedSettings.url || 'https://openai.com/index/introducing-gpt-5/');
  const [language, setLanguage] = useState(savedSettings.language || 'en');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Array<{ speaker: string; text: string }> | null>(null);
  const [isConversationComplete, setIsConversationComplete] = useState(false);
  const [scrapedContent, setScrapedContent] = useState<{ content: string; title: string } | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editedConversation, setEditedConversation] = useState<string>('');
  const [isEditingConversation, setIsEditingConversation] = useState(false);
  const [hasRequestedAudio, setHasRequestedAudio] = useState(false);
  const [hasDownloadedAudio, setHasDownloadedAudio] = useState(false);
  const [conversationTurns, setConversationTurns] = useState(0);
  const [autoGenerateAudio, setAutoGenerateAudio] = useState(savedSettings.autoGenerateAudio || false);
  const prevTurnsRef = useRef(0);
  const [newStartIndex, setNewStartIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [useTranscript, setUseTranscript] = useState(savedSettings.useTranscript || false);
  const [availableVoices, setAvailableVoices] = useState<Array<{ id: string; name: string; category?: string }>>([]);
  const [selectedVoice1, setSelectedVoice1] = useState<string>(savedSettings.selectedVoice1 || 'FF7KdobWPaiR0vkcALHF'); // Custom voice - default
  const [selectedVoice2, setSelectedVoice2] = useState<string>(savedSettings.selectedVoice2 || 'BpjGufoPiobT79j2vtj4'); // Custom voice 2 - default
  const [showArchive, setShowArchive] = useState(false);
  const [archivedFiles, setArchivedFiles] = useState<Array<{ name: string; size: number; createdAt: string; modifiedAt: string }>>([]);
  const [localHistory, setLocalHistory] = useState<HistoryItem[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    const history = loadHistory();
    setLocalHistory(history);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    saveSettings({
      language,
      selectedVoice1,
      selectedVoice2,
      autoGenerateAudio,
      url,
      useTranscript,
    });
  }, [language, selectedVoice1, selectedVoice2, autoGenerateAudio, url, useTranscript]);

  // Fetch available voices on component mount
  useEffect(() => {
    const fetchVoices = async () => {
      try {
        const response = await fetch('/api/voices');
        if (response.ok) {
          const data = await response.json();
          setAvailableVoices(data.voices || []);
        }
      } catch (error) {
        console.error('Failed to fetch voices:', error);
        // Fallback to default voices if API fails
        setAvailableVoices([
          { id: 'FF7KdobWPaiR0vkcALHF', name: 'Ślązak' },
          { id: 'BpjGufoPiobT79j2vtj4', name: 'Góralka' },
        ]);
      }
    };
    fetchVoices();
  }, []);

  const voices = useMemo(() => {
    const voice1 = availableVoices.find(v => v.id === selectedVoice1) || { id: selectedVoice1, name: 'Ślązak' };
    const voice2 = availableVoices.find(v => v.id === selectedVoice2) || { id: selectedVoice2, name: 'Góralka' };
    return [voice1, voice2];
  }, [availableVoices, selectedVoice1, selectedVoice2]);

  const languages = useMemo(() => [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'pl', name: 'Polski', flag: '🇵🇱' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
  ], []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if using transcript mode
    if (useTranscript) {
      if (!transcript.trim()) {
        alert('Please paste a transcript');
        return;
      }
    } else {
      if (!url.trim()) return;
    }

    setIsLoading(true);
    setAudioUrl(null);
    setConversation(null);
    setIsConversationComplete(false);
    setScrapedContent(null);
    setHasRequestedAudio(false);
    setHasDownloadedAudio(false);
    setConversationTurns(0);

    try {
      let content = '';
      let title = '';

      if (useTranscript) {
        // Use transcript directly, skip scraping
        content = transcript.trim();
        title = customTitle.trim() || 'Podcast from Transcript';
        setScrapedContent({ content, title });
      } else {
        // Step 1: Scrape the URL
        const scrapeResponse = await fetch('/api/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
        });

        if (!scrapeResponse.ok) {
          const errorData = await scrapeResponse.json();
          throw new Error(errorData.error || 'Failed to scrape URL');
        }

        const scrapeData = await scrapeResponse.json();
        setScrapedContent(scrapeData);
        content = editedContent || scrapeData.content;
        title = scrapeData.title;
      }

      // Step 2: Generate podcast conversation with streaming
      const podcastResponse = await fetch('/api/generate-podcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          title: title,
          language: language
        }),
      });

      if (!podcastResponse.ok) {
        const errorData = await podcastResponse.json();
        throw new Error(errorData.error || 'Failed to generate podcast');
      }

      // Handle streaming response
      const reader = podcastResponse.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response stream available');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        // Process complete lines
        for (const line of lines) {
          if (line.trim()) {
            try {
              const update = JSON.parse(line);

              if (update.type === 'partial' && update.data?.conversation) {
                setConversation(update.data.conversation);
                setConversationTurns(Array.isArray(update.data.conversation) ? update.data.conversation.length : 0);
              } else if (update.type === 'complete' && update.data?.conversation) {
                setConversation(update.data.conversation);
                setIsConversationComplete(true);
                setConversationTurns(Array.isArray(update.data.conversation) ? update.data.conversation.length : 0);
              } else if (update.type === 'error') {
                const errorMsg = update.error || 'Streaming error';
                console.error('Podcast generation error:', errorMsg);
                throw new Error(errorMsg);
              }
            } catch (parseError) {
              console.error('Error parsing streaming response:', parseError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Error generating podcast:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Something went wrong'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateAudio = useCallback(async () => {
    if (!conversation || !isConversationComplete) return;

    setIsGeneratingAudio(true);

    try {
      const dialogueInputs: DialogueInput[] = conversation.map((item: { speaker: string; text: string }) => ({
        text: item.text,
        voiceId: item.speaker === 'Speaker1' ? voices[0].id : voices[1].id
      }));

      const audioResponse = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: dialogueInputs }),
      });

      if (!audioResponse.ok) {
        const errorData = await audioResponse.json();
        throw new Error(errorData.error || 'Failed to generate audio');
      }

      const audioData = await audioResponse.json();

      // Revoke previous audio URL to free memory (if it was a blob URL)
      if (audioUrl) {
        try { URL.revokeObjectURL(audioUrl); } catch { }
      }

      setAudioUrl(audioData.audioBase64);
    } catch (error) {
      console.error('Error generating audio:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Something went wrong'}`);
    } finally {
      setIsGeneratingAudio(false);
    }
  }, [conversation, isConversationComplete, voices, audioUrl]);

  const getSpeakerName = (speaker: string) => {
    return speaker === 'Speaker1' ? (voices[0]?.name || 'Ślązak') : (voices[1]?.name || 'Góralka');
  };

  const handleEditContent = () => {
    if (scrapedContent) {
      setEditedContent(scrapedContent.content);
      setIsEditingContent(true);
    }
  };

  const handleSaveContent = () => {
    if (scrapedContent) {
      setScrapedContent({
        ...scrapedContent,
        content: editedContent
      });
      setIsEditingContent(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingContent(false);
    setEditedContent('');
  };

  const handleEditConversation = () => {
    if (conversation) {
      // Convert conversation to editable text format
      const conversationText = conversation.map((item) => {
        const speakerName = item.speaker === 'Speaker1' ? 'Ślązak' : 'Góralka';
        return `${speakerName}:\n${item.text}`;
      }).join('\n\n');
      setEditedConversation(conversationText);
      setIsEditingConversation(true);
    }
  };

  const handleSaveConversation = () => {
    if (!editedConversation.trim()) return;

    try {
      // Parse edited conversation back to array format
      const lines = editedConversation.split('\n');
      const newConversation: Array<{ speaker: string; text: string }> = [];
      let currentSpeaker: string | null = null;
      let currentText: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Check if line is a speaker label (supports both old and new format)
        if (trimmedLine.match(/^(Speaker\s*1|Speaker\s*2|Ślązak|Góralka):/i)) {
          // Save previous speaker if exists
          if (currentSpeaker && currentText.length > 0) {
            newConversation.push({
              speaker: currentSpeaker,
              text: currentText.join('\n').trim()
            });
          }
          // Set new speaker (support both formats)
          const lowerLine = trimmedLine.toLowerCase();
          if (lowerLine.includes('speaker 1') || lowerLine.includes('speaker1') || lowerLine.includes('ślązak')) {
            currentSpeaker = 'Speaker1';
          } else if (lowerLine.includes('speaker 2') || lowerLine.includes('speaker2') || lowerLine.includes('góralka')) {
            currentSpeaker = 'Speaker2';
          }
          currentText = [];
        } else if (currentSpeaker) {
          // Add text to current speaker
          currentText.push(trimmedLine);
        }
      }

      // Save last speaker
      if (currentSpeaker && currentText.length > 0) {
        newConversation.push({
          speaker: currentSpeaker,
          text: currentText.join('\n').trim()
        });
      }

      if (newConversation.length > 0) {
        setConversation(newConversation);
        setIsEditingConversation(false);
        setEditedConversation('');
        // Reset audio-related states since conversation changed
        setAudioUrl(null);
        setHasRequestedAudio(false);
        setHasDownloadedAudio(false);
      } else {
        alert('Could not parse conversation. Please use format:\nŚlązak:\nText here\n\nGóralka:\nText here');
      }
    } catch (error) {
      console.error('Error parsing conversation:', error);
      alert('Error parsing conversation. Please check the format.');
    }
  };

  const handleCancelEditConversation = () => {
    setIsEditingConversation(false);
    setEditedConversation('');
  };

  // Automatically start generating audio when conversation is complete (only if auto mode is enabled)
  useEffect(() => {
    if (autoGenerateAudio && isConversationComplete && conversation && !isGeneratingAudio && !audioUrl && !hasRequestedAudio) {
      setHasRequestedAudio(true);
      // Fire and forget; internal state handles progress and errors
      void handleGenerateAudio();
    }
  }, [autoGenerateAudio, isConversationComplete, conversation, isGeneratingAudio, audioUrl, hasRequestedAudio, handleGenerateAudio]);

  // Automatically download MP3 when audio is ready
  useEffect(() => {
    if (audioUrl && !isGeneratingAudio && !hasDownloadedAudio) {
      if (autoGenerateAudio) {
        // Small delay to ensure audio is fully loaded
        const timer = setTimeout(() => {
          downloadAudio();
          archiveAudio().then(() => {
            // Reload archive list after archiving
            if (showArchive) {
              loadArchivedFiles();
            }
          });
          setHasDownloadedAudio(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [audioUrl, isGeneratingAudio, hasDownloadedAudio, autoGenerateAudio, showArchive]);

  // Agentic progress steps
  type StepStatus = 'pending' | 'in_progress' | 'complete';
  const steps = useMemo(() => {
    const hasScraped = !!scrapedContent;
    const hasConversation = !!conversation;
    const convoDone = isConversationComplete;
    const hasAudio = !!audioUrl;
    const hasTranscript = useTranscript && !!transcript.trim();

    const scrapeStatus: StepStatus = isLoading && !hasScraped && !hasTranscript ? 'in_progress' : (hasScraped || hasTranscript) ? 'complete' : 'pending';
    const convoStatus: StepStatus = hasConversation && !convoDone ? 'in_progress' : convoDone ? 'complete' : (hasScraped || hasTranscript) ? 'pending' : 'pending';
    const audioStatus: StepStatus = isGeneratingAudio ? 'in_progress' : hasAudio ? 'complete' : convoDone ? 'pending' : 'pending';
    const doneStatus: StepStatus = hasAudio ? 'complete' : 'pending';

    return [
      { key: 'scrape', label: useTranscript ? 'Load Transcript' : 'Scrape Source', status: scrapeStatus as StepStatus },
      { key: 'conversation', label: 'Generate Conversation', status: convoStatus as StepStatus },
      { key: 'audio', label: 'Generate Audio', status: audioStatus as StepStatus },
      { key: 'done', label: 'Ready', status: doneStatus as StepStatus },
    ];
  }, [scrapedContent, conversation, isConversationComplete, isGeneratingAudio, audioUrl, isLoading, useTranscript, transcript]);

  const currentAction = useMemo(() => {
    const inProgress = steps.find((s) => s.status === 'in_progress');
    if (inProgress) {
      if (inProgress.key === 'conversation') {
        return `Streaming conversation (${conversationTurns} turns)`;
      }
      if (inProgress.key === 'audio') {
        return 'Calling TTS and composing audio';
      }
      return inProgress.label;
    }
    if (audioUrl) return isPlaying ? 'Playing podcast' : 'Podcast ready';
    if (isLoading) return 'Starting…';
    return 'Awaiting URL';
  }, [steps, audioUrl, isLoading, conversationTurns, isPlaying]);

  const nextSteps = useMemo(() => {
    const firstPendingIdx = steps.findIndex((s) => s.status !== 'complete');
    if (firstPendingIdx === -1) return [] as string[];
    const labels = steps.slice(firstPendingIdx).map((s) => s.label);
    // If something is in progress, include remaining after it
    const inProgressIdx = steps.findIndex((s) => s.status === 'in_progress');
    if (inProgressIdx >= 0) return steps.slice(inProgressIdx + 1).map((s) => s.label);
    return labels;
  }, [steps]);

  // Track boundaries for animating newly streamed items
  useEffect(() => {
    if (conversationTurns > prevTurnsRef.current) {
      setNewStartIndex(prevTurnsRef.current);
      prevTurnsRef.current = conversationTurns;
    } else if (conversationTurns < prevTurnsRef.current) {
      prevTurnsRef.current = conversationTurns;
      setNewStartIndex(0);
    }
  }, [conversationTurns]);

  // Simple SVG avatar for each speaker (gradient + initial)
  const Avatar = ({ name, tone }: { name: string; tone: 'left' | 'right' }) => {
    const initial = (name || '?').slice(0, 1).toUpperCase();
    const gradId = `grad-${tone}`;
    const g1 = tone === 'left' ? '#8b5cf6' : '#06b6d4';
    const g2 = tone === 'left' ? '#ec4899' : '#22c55e';
    return (
      <svg viewBox="0 0 40 40" className="h-10 w-10 lg:h-12 lg:w-12 rounded-full shadow-md">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={g1} />
            <stop offset="100%" stopColor={g2} />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill={`url(#${gradId})`} opacity="0.9" />
        <text x="50%" y="54%" textAnchor="middle" fontSize="22" fontWeight="700" fill="white" fontFamily="system-ui, -apple-system, Segoe UI, Roboto">{initial}</text>
      </svg>
    );
  };

  // Audio controls logic
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // When a new audio URL arrives, ensure we reset play state and load it
    setIsPlaying(false);
    try { el.pause(); } catch { }
    el.currentTime = 0;
    // src bound in JSX; calling load helps reset metadata
    try { el.load(); } catch { }
  }, [audioUrl]);

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!audioUrl) return;
    try {
      if (el.paused) {
        await el.play();
        setIsPlaying(true);
      } else {
        el.pause();
        setIsPlaying(false);
      }
    } catch (e) {
      console.error('Audio play/pause error', e);
    }
  };

  const restartAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!audioUrl) return;
    try {
      el.currentTime = 0;
      if (!el.paused) {
        el.play();
      }
    } catch (e) {
      console.error('Audio restart error', e);
    }
  };

  const downloadAudio = () => {
    if (!audioUrl) return;

    try {
      // Convert base64 data URL to blob
      const base64Data = audioUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'audio/mpeg' });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `podcast-${Date.now()}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Audio download error', e);
      alert('Failed to download audio. Please try again.');
    }
  };

  // Archive audio function
  const archiveAudio = async () => {
    if (!audioUrl || !conversation) return;

    try {
      const title = scrapedContent?.title || customTitle || 'Untitled Podcast';
      const timestamp = Date.now();
      const filename = `${title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}_${timestamp}.mp3`;
      
      // Calculate approximate size (base64 is ~33% larger than binary)
      const base64Data = audioUrl.includes(',') ? audioUrl.split(',')[1] : audioUrl;
      const sizeBytes = (base64Data.length * 3) / 4;
      
      // Save to localStorage
      const historyItem: HistoryItem = {
        id: `local_${timestamp}`,
        title,
        filename,
        createdAt: new Date().toISOString(),
        size: sizeBytes,
        conversation,
        // Don't store full audio in localStorage (too large), just metadata
        audioBase64: undefined,
      };
      addToHistory(historyItem);
      setLocalHistory(loadHistory());
      
      // Also try to save to server
      try {
        const response = await fetch('/api/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: audioUrl,
            title,
            conversation,
          }),
        });

        if (response.ok) {
          console.log('Audio archived successfully to server');
          // Reload archive list after successful archiving
          loadArchivedFiles();
        } else {
          console.error('Failed to archive audio to server, but saved locally');
        }
      } catch (serverError) {
        console.error('Error archiving to server, but saved locally:', serverError);
      }
    } catch (error) {
      console.error('Error archiving audio:', error);
    }
  };

  // Load archived files (combine server and local storage)
  const loadArchivedFiles = async () => {
    try {
      // Load from server
      const response = await fetch('/api/archive');
      if (response.ok) {
        const data = await response.json();
        setArchivedFiles(data.files || []);
      }
    } catch (error) {
      console.error('Error loading archived files from server:', error);
    }
    
    // Also load from localStorage
    const localHistory = loadHistory();
    setLocalHistory(localHistory);
  };

  // Load archive when archive view is shown
  useEffect(() => {
    if (showArchive) {
      loadArchivedFiles();
    }
  }, [showArchive]);

  return (
    <div className="monolith-container">
      {/* Top Header */}
      <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent tracking-tight">
        AI Podcast Generator
      </h1>

      {/* Status Bar */}
      <div className="status-bar">
        <div style={{ display: 'flex', gap: '40px', alignItems: 'center', width: '100%' }}>
          <div style={{ marginRight: 'auto', fontSize: '14px', color: '#888', fontWeight: 500, letterSpacing: '0.01em', lineHeight: '1.5' }}>
            Agent Status: <span style={{ color: '#fff' }}>{currentAction}</span>
          </div>
          {steps.map((step, idx) => (
            <div key={step.key} className={`step-item ${step.status === 'in_progress' || step.status === 'complete' ? 'active' : ''}`}>
              <div className="step-dot"></div>
              {idx + 1}. {step.label}
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: '14px', color: '#555', fontWeight: 500, letterSpacing: '0.01em', lineHeight: '1.5' }}>
            Next: {nextSteps[0] || 'Ready'}
          </div>
        </div>
      </div>

      <div className="monolith-grid">
        {/* COLUMN 1: SOURCE */}
        <div className="slab" style={{ height: '800px', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <h3 className="monolith-title">Source</h3>
          </div>

          {/* Source Tabs */}
          <div className="tab-group">
            <button
              className={`tab-btn ${!useTranscript ? 'active' : ''}`}
              onClick={() => { setUseTranscript(false); }}
            >
              URL
            </button>
            <button
              className={`tab-btn ${useTranscript ? 'active' : ''}`}
              onClick={() => { setUseTranscript(true); }}
            >
              Transcript
            </button>
          </div>

          {/* Language */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>Language / Język</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isLoading}
              className="monolith-select"
              suppressHydrationWarning
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title Input */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>Title (Optional)</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="excavated-input"
              placeholder="Podcast Title"
              disabled={isLoading}
              suppressHydrationWarning
            />
          </div>

          {/* Main Input Area */}
          {!useTranscript ? (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="excavated-input"
                placeholder="https://example.com/article"
                disabled={isLoading}
                suppressHydrationWarning
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginBottom: '20px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>Transcript / Transkrypt</label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="monolith-textarea"
                style={{ flex: 1, minHeight: '200px', fontSize: '12px', lineHeight: '1.5', resize: 'none', height: '100%' }}
                placeholder="Paste content here..."
                disabled={isLoading}
              />
            </div>
          )}

          {/* Scraped Content Preview */}
          {scrapedContent && (
            <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
              <div className="section-header" style={{ border: 'none', padding: 0, marginBottom: '10px' }}>
                <h3 className="monolith-title" style={{ fontSize: '11px' }}>Scraped Content</h3>
                <button onClick={handleEditContent} className="monolith-btn small primary">Edit</button>
              </div>
              <div style={{ fontSize: '10px', color: '#666', maxHeight: '100px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                {scrapedContent.title && <strong style={{ color: '#fff', display: 'block', marginBottom: '4px' }}>{scrapedContent.title}</strong>}
                {scrapedContent.content.substring(0, 300)}...
              </div>
            </div>
          )}

          {/* Generate Action */}
          <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <button
              onClick={(e) => handleSubmit(e as any)}
              disabled={isLoading || (!useTranscript && !url.trim()) || (useTranscript && !transcript.trim())}
              className="monolith-btn primary"
              style={{ width: '100%' }}
            >
              {isLoading ? 'Processing...' : 'Generate Conversation'}
            </button>
          </div>
        </div>

        {/* COLUMN 2: CONVERSATION */}
        <div className="slab" style={{ height: '800px', display: 'flex', flexDirection: 'column' }}>
          <div className="section-header">
            <h3 className="monolith-title">Conversation</h3>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {!isEditingConversation ? (
                <button onClick={conversation ? handleEditConversation : undefined} disabled={!conversation} className="monolith-btn small primary">Edit</button>
              ) : (
                <>
                  <button onClick={handleSaveConversation} className="monolith-btn small primary">Save</button>
                  <button onClick={handleCancelEditConversation} className="monolith-btn small">Cancel</button>
                </>
              )}
              {!isEditingConversation && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#888' }}>
                  <div
                    onClick={() => setAutoGenerateAudio(!autoGenerateAudio)}
                    style={{
                      width: '12px',
                      height: '12px',
                      border: '1px solid',
                      borderColor: autoGenerateAudio ? 'var(--accent-celadon)' : '#444',
                      background: autoGenerateAudio ? 'var(--accent-celadon)' : 'transparent',
                      boxShadow: autoGenerateAudio ? '0 0 5px var(--accent-celadon-glow)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      borderRadius: '2px'
                    }}
                  ></div>
                  Auto Generate Audio
                </div>
              )}
            </div>
          </div>

          <div className="chat-container" style={isEditingConversation ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}}>
            {isEditingConversation ? (
              <textarea
                value={editedConversation}
                onChange={(e) => setEditedConversation(e.target.value)}
                className="monolith-textarea"
                style={{ 
                  flex: 1, 
                  minHeight: '400px', 
                  fontSize: '13px', 
                  lineHeight: '1.6',
                  fontFamily: 'monospace',
                  resize: 'none',
                  width: '100%',
                  height: '100%'
                }}
                placeholder="Ślązak:&#10;Text here&#10;&#10;Góralka:&#10;Text here"
              />
            ) : conversation ? (
              conversation.map((item, index) => (
                <div key={index} className={`chat-bubble ${item.speaker === 'Speaker1' ? 's1' : 's2'}`}>
                  <div className="speaker-label">
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: item.speaker === 'Speaker1' ? '#a855f7' : '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}>
                      {item.speaker === 'Speaker1' ? 'S' : 'S'}
                    </div>
                    {getSpeakerName(item.speaker)}
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: '1.6', color: '#d4d4d8' }}>{item.text}</div>
                </div>
              ))
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '13px' }}>
                Conversation will appear here...
              </div>
            )}
            {!isEditingConversation && <div ref={(el) => { if (el) el.scrollIntoView({ behavior: 'smooth' }); }}></div>}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <button
              onClick={handleGenerateAudio}
              disabled={!conversation || isGeneratingAudio}
              className="monolith-btn primary"
              style={{ width: '100%' }}
            >
              {isGeneratingAudio ? 'Generating Audio...' : 'Generate Audio'}
            </button>
          </div>
        </div>

        {/* COLUMN 3: OUTPUT & SETTINGS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Audio Player */}
          <div className={`slab ${isGeneratingAudio ? 'generating-audio' : audioUrl ? 'audio-ready' : ''}`}>
            <div className="section-header">
              <h3 className="monolith-title">Audio</h3>
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
              Ready to generate audio. Use the button below.
            </div>

            <div style={{ background: '#000', borderRadius: '12px', padding: '24px', minHeight: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {audioUrl ? (
                <div style={{ width: '100%' }}>
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    style={{ width: '100%', marginBottom: '10px' }}
                  />
                  <button onClick={downloadAudio} className="monolith-btn small" style={{ width: '100%' }}>Download MP3</button>
                </div>
              ) : (
                <div style={{ color: '#444', fontSize: '13px' }}>No audio yet.</div>
              )}
            </div>
          </div>

          {/* Voices */}
          <div className="slab">
            <div className="section-header">
              <h3 className="monolith-title">Voices</h3>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>Ślązak:</label>
              <select
                className="monolith-select"
                value={selectedVoice1}
                onChange={(e) => setSelectedVoice1(e.target.value)}
                suppressHydrationWarning
              >
                {availableVoices.filter(v => v.id).map((v, idx) => <option key={`voice1-${v.id || idx}`} value={v.id}>{v.name} {v.category ? `(${v.category})` : ''}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '6px', display: 'block' }}>Góralka:</label>
              <select
                className="monolith-select"
                value={selectedVoice2}
                onChange={(e) => setSelectedVoice2(e.target.value)}
                suppressHydrationWarning
              >
                {availableVoices.filter(v => v.id).map((v, idx) => <option key={`voice2-${v.id || idx}`} value={v.id}>{v.name} {v.category ? `(${v.category})` : ''}</option>)}
              </select>
            </div>
          </div>

          {/* Archive Link (Mini) */}
          <div className="slab" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#666', fontWeight: 600 }}>History</span>
              <button 
                onClick={() => {
                  setShowArchive(!showArchive);
                  if (!showArchive) {
                    loadArchivedFiles();
                  }
                }} 
                style={{ background: 'transparent', border: '1px solid #333', borderRadius: '4px', color: '#888', fontSize: '10px', padding: '4px 10px', cursor: 'pointer' }}
              >
                {showArchive ? 'Hide Archive' : 'View Archive'}
              </button>
            </div>
            
            {showArchive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto', marginTop: '8px' }}>
                {archivedFiles.length === 0 && localHistory.length === 0 ? (
                  <div style={{ color: '#666', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
                    No archived files yet
                  </div>
                ) : (
                  <>
                    {/* Server files */}
                    {archivedFiles.map((file, idx) => (
                      <div key={`server-${file.name || idx}`} style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: '12px', fontWeight: 500, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                          <div style={{ color: '#666', fontSize: '10px' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a href={`/api/archive/${file.name}`} download className="monolith-btn small" style={{ height: 'fit-content', textDecoration: 'none', display: 'flex', alignItems: 'center', padding: '4px 8px' }}>Download</a>
                          <button
                            onClick={async () => {
                              if (confirm('DELETE THIS FILE?')) {
                                try {
                                  const response = await fetch(`/api/archive?filename=${encodeURIComponent(file.name)}`, {
                                    method: 'DELETE',
                                  });
                                  if (response.ok) {
                                    loadArchivedFiles();
                                  }
                                } catch (error) {
                                  console.error('Error deleting file:', error);
                                }
                              }
                            }}
                            className="monolith-btn small danger"
                            style={{ padding: '4px 8px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {/* Local storage files */}
                    {localHistory.map((item, idx) => (
                      <div key={`local-${item.id || idx}`} style={{ padding: '10px', background: 'rgba(37, 211, 102, 0.05)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', border: '1px solid rgba(37, 211, 102, 0.2)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: '12px', fontWeight: 500, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                          <div style={{ color: '#666', fontSize: '10px' }}>
                            {item.size ? `${(item.size / 1024 / 1024).toFixed(2)} MB` : 'Local'} • {new Date(item.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => {
                              // Try to download from server first
                              const serverFile = archivedFiles.find(f => f.name === item.filename);
                              if (serverFile) {
                                window.open(`/api/archive/${item.filename}`, '_blank');
                              } else {
                                alert('File is only stored locally. Audio data not available for download.');
                              }
                            }}
                            className="monolith-btn small"
                            style={{ padding: '4px 8px' }}
                          >
                            Download
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('DELETE THIS FILE FROM LOCAL STORAGE?')) {
                                const history = loadHistory();
                                const filtered = history.filter(h => h.id !== item.id);
                                saveHistory(filtered);
                                setLocalHistory(filtered);
                              }
                            }}
                            className="monolith-btn small danger"
                            style={{ padding: '4px 8px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

function pointerButtons(c: any): 'pointer' | 'default' { return c ? 'pointer' : 'default'; }

