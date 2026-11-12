"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, Language } from '@/lib/translations';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: typeof translations['en'];
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguage] = useState<Language>('zh'); // Default to Chinese

    useEffect(() => {
        // 隐私模式等场景下 localStorage 可能抛错，读不到就保持默认中文
        try {
            const savedLang = localStorage.getItem('app-language');
            if (savedLang === 'zh' || savedLang === 'en') {
                setLanguage(savedLang);
            }
        } catch {
            // ignore
        }
    }, []);

    // 同步 <html lang>，读屏与浏览器翻译依赖它（layout 中的静态值只是首屏默认）
    useEffect(() => {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    }, [language]);

    const handleSetLanguage = (lang: Language) => {
        setLanguage(lang);
        try {
            localStorage.setItem('app-language', lang);
        } catch {
            // ignore
        }
    };

    const value = {
        language,
        setLanguage: handleSetLanguage,
        t: translations[language],
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
