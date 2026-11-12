"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, House, Award } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { parseStoredVariants, VariantMap } from "@/lib/practice-variants";
import { PracticeChallenge } from "@/components/practice-challenge";

export const dynamic = 'force-dynamic';

function PracticeContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const errorItemId = searchParams.get("id");
    const requestedLevel = searchParams.get("difficulty");
    const { t } = useLanguage();
    const [variants, setVariants] = useState<VariantMap | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!errorItemId) return;
        apiClient.get<{ ocrText?: string | null }>(`/api/error-items/${errorItemId}`)
            .then((item) => setVariants(parseStoredVariants(item?.ocrText)))
            .catch((err) => {
                console.warn("Failed to load error item", err);
                setLoadError(true);
            });
    }, [errorItemId]);

    if (!errorItemId) {
        return <div className="p-8 text-center">{t.practice.invalidRequest || "Invalid Request"}</div>;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-16">
            <div className="flex justify-between items-center mb-2">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t.common?.back || "返回错题"}
                </Button>
                <Button asChild variant="ghost" size="icon">
                    <Link href="/" aria-label="返回首页">
                        <House className="h-5 w-5" />
                    </Link>
                </Button>
            </div>

            <div className="text-center space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    <Award className="h-3.5 w-3.5" />
                    <span>举一反三闯关</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold">举一反三</h1>
                <p className="text-sm text-muted-foreground">
                    逐关挑战：类似题型 → 困难模式 → 挑战压轴。每关每天一次机会，答对即通关并解锁下一关。
                </p>
            </div>

            {loadError ? (
                <p className="text-center text-sm text-destructive">加载错题失败，请返回重试</p>
            ) : variants ? (
                <PracticeChallenge errorItemId={errorItemId} initialVariants={variants} requestedLevel={requestedLevel} />
            ) : (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}

export default function PracticePage() {
    return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
            <Suspense
                fallback={
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                }
            >
                <PracticeContent />
            </Suspense>
        </main>
    );
}
